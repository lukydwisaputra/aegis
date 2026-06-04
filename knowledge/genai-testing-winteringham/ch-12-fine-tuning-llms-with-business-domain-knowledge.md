---
book: genai-testing-winteringham
chapter: 12
title: "Fine-tuning LLMs with business domain knowledge"
pages: "242-261"
topics:
  - fine-tuning
  - llm-customization
  - domain-knowledge
  - training-data-curation
  - training-data-format
  - evaluation-metrics
  - jsonl
  - lora
  - peft
  - emerging-tech
applies_to_agents:
  - qa-orchestrator
  - qa-curator
cross_refs:
  - "[[ch-10-introducing-customized-llms]]"
  - "[[ch-11-contextualizing-prompts-with-rag]]"
---

# Chapter 12 — Fine-tuning LLMs with business domain knowledge

> Fine-tuning takes a pre-existing (foundational) model and continues its training on a
> smaller, domain-specific dataset so that its weights are biased toward the behaviours
> and knowledge a team needs. The chapter walks through an end-to-end session using
> Meta's Llama-2-7b, a JSONL dataset derived from the restful-booker-platform Java
> codebase, the Axolotl fine-tuning framework, and the LoRA parameter-efficient
> adaptation technique. The practical lesson is that dataset quality and structure
> dominate everything else; tooling and compute are secondary concerns.

---

## 1. What fine-tuning is and when to use it

### 1.1 Fine-tuning in one sentence

Fine-tuning is the continuation of a model's training process beyond its original
pre-training phase. The base (foundational) model already knows grammar, reasoning
patterns, and general world knowledge from billions of tokens. Fine-tuning skews its
weights further toward a narrower domain or response style using a dataset that is
orders of magnitude smaller than the original training corpus.

### 1.2 Where fine-tuning sits on the customisation spectrum

Chapter 10 introduced three points on the LLM-customisation spectrum:

| Technique | What changes | Data required | Cost |
|---|---|---|---|
| Prompt engineering | Nothing — context is injected at runtime | None | Near-zero |
| RAG (Ch. 11) | Nothing — context is retrieved and injected | A queryable corpus | Low-to-medium |
| Fine-tuning | Model weights | A labelled training dataset | High |

Fine-tuning is the highest-effort option but the only one that permanently changes how
the model reasons and communicates. Use it when:

- The required knowledge is stable and unlikely to change frequently.
- Response style or domain-specific vocabulary needs to be consistent across all
  queries, not just the ones where a relevant document is retrieved.
- Context-window constraints or latency budgets make runtime injection impractical.
- Intellectual-property constraints prevent sending proprietary data to a third-party
  API on every call.

### 1.3 When NOT to fine-tune

Fine-tuning is the wrong choice when RAG or prompt engineering would achieve the
same result at lower cost. Common misapplications:

- The knowledge domain updates frequently (retraining for every update is expensive).
- The goal is to inject a few extra facts rather than reshape reasoning patterns.
- The team lacks the labelled dataset, compute budget, or ML experience to evaluate
  whether the tuned model actually improved.

---

## 2. Goal-setting before tuning

Every fine-tuning project must begin with a precise behavioural goal. The goal answers
three questions:

1. **What should the model do?** (Generate code? Answer domain questions? Classify
   artefacts? Summarise reports?)
2. **What data already exists to teach it?** (Codebase files, support documentation,
   past test reports, historical defect logs?)
3. **What does success look like?** (A measurable benchmark, a human-validation rubric,
   a loss target?)

Without a concrete goal, every downstream decision — model selection, dataset design,
prompt template, evaluation criteria — has no anchor.

### 2.1 Goal shapes data, model, and hardware choices

The chapter illustrates this with two contrasting goals:

**Code-completion assistant** tuned on a proprietary Java codebase:
- Dataset: parsed code snippets paired with questions about class structure and method
  behaviour.
- Base model: one already pre-trained on large code corpora (e.g., CodeLlama,
  Llama-2) to shorten the distance between pretrained knowledge and the target domain.
- Hardware: moderate; 7B-parameter models fit on a single consumer-grade GPU with
  LoRA.

**Q&A/chat support bot** tuned on product documentation and customer data:
- Dataset: instruction-output pairs derived from FAQs, help articles, and support
  ticket resolutions.
- Base model: a chat-tuned model (already trained for conversational format).
- Hardware: similar, but token lengths per entry tend to be longer.

Both examples require the same planning discipline; they differ only in the artefact that
becomes training data and the base model architecture that best matches the task.

---

## 3. Preparing the training dataset

### 3.1 Why dataset work dominates fine-tuning effort

The chapter is emphatic: most of the work in a fine-tuning project is in dataset
curation. The fine-tuning loop itself is automated and reproducible; producing a
high-quality, correctly structured dataset is not.

Three public reference datasets illustrate scale and format diversity:

- **The Stack** — ~546 million rows of open-source code scraped from GitHub.
- **Alpaca** — ~52,000 rows of synthetic instruction-output pairs generated by an
  existing LLM.
- **OpenOrca** — ~2.9 million rows of question-and-response data.

Size does not determine quality. Alpaca is dramatically smaller than The Stack or
OpenOrca but has been used effectively for instruction fine-tuning because its
structure and instruction diversity are well-designed.

### 3.2 Synthetic data as a data-generation strategy

When real organisational data is insufficient, sparse, or sensitive, synthetic data can
fill gaps. Tools such as gretel.ai, mostly.ai, and tonic.ai offer generation capabilities.
Two cautions apply:

1. Synthetic generation has monetary cost.
2. Models trained exclusively on synthetic data produce lower-quality outputs than
   those trained on real data. Real artefacts carry genuine variance and edge cases that
   synthetic generation tends to smooth away.

The recommended practice is to use synthetic data to augment a real dataset, not to
replace it entirely.

### 3.3 The Alpaca format as a baseline structure

The chapter uses the Alpaca dataset structure as a reference template. Each row
contains four columns:

| Column | Purpose |
|---|---|
| `instruction` | The question or task to pose to the model |
| `input` | Optional additional context for the task |
| `output` | The expected response |
| `text` | The fully assembled prompt string (used during some tuning configurations) |

For instruction-only fine-tuning (no additional input context), only `instruction` and
`output` are required as a minimum.

### 3.4 JSONL as the standard serialisation format

The worked example uses **JSONL** (JSON Lines): one JSON object per line, each object
containing `instruction` and `output` keys. Sample:

```
{"instruction": "What is the class declaration for BrandingServiceIT",
 "output": "@ExtendWith\n@SpringBootTest\n@ActiveProfiles\npublic class BrandingServiceIT { }"}
{"instruction": "How does the method setupRestito work for BrandingServiceIT?",
 "output": "@BeforeEach\npublic void setupRestito(){\nwhenHttp(server)...}"}
```

JSONL is universally supported by fine-tuning frameworks (Axolotl, Hugging Face
Trainer, OpenAI fine-tune API) and is straightforward to generate programmatically.

### 3.5 Granularity decisions: the wrong approach and the right one

The chapter documents a specific failure before arriving at the correct approach.

**First attempt — line-by-line parsing:**
An initial script iterated each source file and wrote one line of code per dataset row.
This produced entries such as `}` or `@Autowired` that carried no standalone context
and could not be paired with a meaningful instruction. The resulting fine-tuned model
behaved unexpectedly.

**Corrected approach — semantic-unit parsing:**
The dataset was rebuilt by parsing each Java file with JavaParser, constructing an
abstract syntax tree, and slicing the tree into logical units: class declarations,
field declarations, individual methods. Each unit was stored as a single dataset entry
paired with an instruction that asked about that unit by name.

This kept each entry detailed enough for the model to infer context while avoiding
the meaningless fragments produced by line-level slicing. The lesson is directly
transferable to any domain: the granularity of dataset entries should match the
granularity at which users will later query the model.

---

## 4. Preprocessing: tokenisation and context length

### 4.1 What tokenisation does

Before fine-tuning can begin, every text entry in the dataset must be converted from
human-readable characters to a sequence of token identifiers — numbers that index
into the model's vocabulary. This conversion is performed by a **tokeniser** that is
specific to the model architecture being tuned.

Using a mismatched tokeniser (one that does not correspond to the base model's
vocabulary) is equivalent to teaching a course in a language the student does not
speak: the token identifiers will not align with the parameter positions inside the
model, and the tuning session will produce noise.

### 4.2 Context length as a hard constraint

Every model has a **context length**: the maximum number of tokens it can process
in a single forward pass. Llama-2-7b, the model used in the chapter's example, has a
4,096-token context window.

Dataset entries or prompt templates that exceed the context length are silently
truncated. Fine-tuning on truncated prompts produces a model tuned on partial,
context-broken examples, which creates unpredictable response behaviour.

Practical implications:

- Remove or split dataset entries whose combined token count (prompt template +
  instruction + output) would overflow the context length.
- Keep the prompt template concise; verbose preambles eat tokens that could carry
  training signal.
- If entries are frequently close to the limit, consider switching to a model with a
  larger context window.

### 4.3 The preprocessing step

In the Axolotl workflow, tokenisation is a discrete, reviewable phase run before the
fine-tuning loop starts:

```
CUDA_VISIBLE_DEVICES="" python -m axolotl.cli.preprocess examples/llama-2/lora.yml
```

This downloads the dataset from Hugging Face, runs it through the configured
tokeniser, and writes the tokenised output to disk. Running preprocessing separately
allows the team to verify token counts before committing to an expensive GPU training
session.

---

## 5. The fine-tuning loop

### 5.1 Instruction-based fine-tuning step by step

The canonical fine-tuning loop for instruction-tuning:

1. Pull one row from the dataset.
2. Inject `instruction` (and optionally `input`) into a prompt template.
3. Send the populated prompt to the model.
4. Receive the model's response.
5. Compare the response against the `output` field using a sentiment/similarity score
   (the **loss**).
6. Compute parameter adjustments based on the loss and the learning rate.
7. Apply adjustments to the model weights.
8. Repeat across all rows; one full pass through the dataset is one **epoch**.
9. Repeat for the configured number of epochs.

Steps 1–7 happen automatically inside the fine-tuning framework; the team controls
only the configuration.

### 5.2 Prompt template design for fine-tuning

The prompt template used during fine-tuning must be consistent with the template
that will be used during inference. Misalignment between the two creates a training /
serving skew that degrades performance.

A minimal instruction-only template (from the deeplearning.ai Finetuning LLMs
course):

```
Below is an instruction that describes a task. Write a response that
appropriately completes the request.

### Instruction:
{instruction}

### Response:
```

For the restful-booker-platform dataset the author customised this to:

```
Below is an instruction, delimited by three hashes, that asks a question
about the restful booker platform code base. Respond with the necessary
code to answer the question. Check that the code compiles correctly before
outputting it.
###
{instruction}
###
```

The additional constraint ("Check that the code compiles correctly") is a quality gate
that attempts to bias the model toward syntactically valid code outputs. Whether it
actually achieves that depends on whether the training outputs themselves are
consistently valid.

### 5.3 Loss, learning rate, and epoch as live metrics

During the Axolotl training run, the console emits one progress line per step:

```
{'loss': 1.0936, 'learning_rate': 0.00019999, 'epoch': 0.02}
```

| Metric | Meaning | What to watch for |
|---|---|---|
| `loss` | Divergence between the model's response and the expected output. Lower is better. | Should decrease over epochs; if it plateaus early or increases, the dataset or hyperparameters need revisiting. |
| `learning_rate` | Step size of parameter adjustments. Controlled by the `lr` hyperparameter. | Large steps tune aggressively and may overshoot; small steps are stable but slow. |
| `epoch` | Progress through the current pass over the dataset. | Shows how far into training the session is; used for time estimation. |

A high initial loss is normal; the model's weights begin misaligned with the training
target. Progressive loss reduction across epochs indicates successful tuning.

---

## 6. LoRA — parameter-efficient fine-tuning

### 6.1 What LoRA does

**LoRA (Low-Rank Adaptation)** is a widely adopted technique for fine-tuning large
models without modifying all of their parameters directly. Instead of updating every
weight in the model, LoRA inserts small, low-rank matrices alongside the original
weight matrices and trains only those adapter matrices. The original model weights
remain frozen.

At inference time, the model is loaded with the LoRA adapter merged or attached,
producing the tuned behaviour without permanently modifying the base checkpoint.

### 6.2 Why LoRA is now the default for most fine-tuning

- **Speed**: fewer parameters to update means faster training iterations.
- **Memory**: the adapter is small; it fits in GPU memory alongside the frozen base
  model even on consumer hardware.
- **Shareability**: LoRA adapters are portable. A team can publish or distribute an
  adapter independently of the multi-gigabyte base model, enabling community
  collaboration without sharing proprietary base weights.
- **Reversibility**: because the base weights are frozen, the adapter can be detached
  and a different adapter applied, making multi-domain specialisation practical.

LoRA falls under the broader category of **PEFT (Parameter-Efficient Fine-Tuning)**
techniques, which includes QLoRA (quantised LoRA for even smaller memory footprints)
and prefix-tuning. The Axolotl framework supports all of these through YAML
configuration changes.

---

## 7. Tooling and infrastructure

### 7.1 The tooling landscape

Three layers of tooling are involved in a fine-tuning project:

**Low-level ML libraries** (PyTorch, TensorFlow, Keras): give full control over every
aspect of the training loop, tokeniser, and model architecture. High learning curve;
best when the team has existing ML engineering expertise.

**Mid-level frameworks** (Axolotl, Hugging Face Trainer, llm.c): opinionated wrappers
around the low-level libraries. They make common fine-tuning workflows configurable
through YAML or a minimal API rather than Python code. Faster to start but less
flexible at the edges.

**Managed platforms** (Hugging Face AutoTrain, OpenAI fine-tune API, Vertex AI):
handle everything, including compute provisioning. Least control; highest monetary
cost per run.

### 7.2 Axolotl for accessible fine-tuning

The chapter uses **Axolotl** as the primary tool because it reduces the entry barrier
without sacrificing the ability to experiment. Key features:

- YAML-driven configuration (model, tokeniser, dataset path, prompt template,
  hyperparameters are all declared in a single file).
- Built-in LoRA support via `lora.yml` example configurations.
- `sample_packing` flag to control whether the dataset is split into training and
  validation subsets (set to `false` when the dataset is too small to split).
- `num_epochs` to control how many full passes over the dataset the tuner makes.

A minimal Axolotl configuration change to point at the RBP dataset on Hugging Face:

```yaml
datasets:
  - path: 2bittester/rbp-data-set
    type: alpaca

base_model: NousResearch/Llama-2-7b-hf
tokenizer_type: LlamaTokenizer

sample_packing: false
num_epochs: 4
```

### 7.3 Hardware and cloud compute

GPU access is mandatory. A fine-tuning session with a 7B-parameter model and a
modest dataset can take 30 minutes to 4+ hours depending on GPU class. Options:

| Approach | Examples | Notes |
|---|---|---|
| Local GPU | Workstation with RTX 4090 | Upfront hardware cost; no per-session fee |
| Cloud ML platforms | Google Vertex AI, AWS SageMaker, Azure ML | High per-session cost; easier model deployment |
| Specialist GPU cloud | RunPod, Latitude.sh, Lambda Labs | Lower per-session cost than major cloud; Axolotl Docker images pre-installed on RunPod |

The author ran the chapter's worked example on RunPod with a single RTX 4090 pod
for under $10 in total compute cost. This is a practical starting point for teams
exploring fine-tuning without large infrastructure budgets.

---

## 8. Testing a fine-tuned model

### 8.1 Two evaluation strategies

**Inference testing (automated):**
A held-out evaluation dataset — structured identically to the training dataset but
containing instructions the model was not trained on — is used to probe generalisation.
Each instruction is sent to the tuned model; the response is compared against the
expected output using the same sentiment/loss mechanism as training. A high
similarity score across the evaluation set indicates successful generalisation.

The key difference between training and inference evaluation is that inference does not
update the weights. The model is observed, not adjusted.

**Human validation (manual):**
A reviewer sends novel prompts to the tuned model through an interactive UI and
evaluates whether the responses are correct, coherent, and safe. Human validation
catches failure modes that sentiment scoring misses: hallucinations that are
syntactically plausible, responses that answer the wrong question at high similarity
to the expected output, or outputs that are technically correct but practically
misleading.

Both strategies are complementary. Automated inference provides breadth and
repeatability; human validation provides depth and qualitative judgement.

### 8.2 Gradio for interactive manual testing

Axolotl can launch a Gradio web interface over the tuned model:

```
accelerate launch -m axolotl.cli.inference examples/llama-2/lora.yml \
    --lora_model_dir="./lora-out" --gradio
```

This loads the frozen Llama-2 base and attaches the LoRA adapter, then exposes a
chat-style browser interface. It allows the team to probe the model with arbitrary
prompts without writing additional inference code.

### 8.3 Interpreting the results — the worked example

After fine-tuning on the RBP JSONL dataset, the tuned model was asked questions
drawn directly from the training data and then from outside the training data.

**In-distribution query** (training data verbatim): the model returned the expected
Java method body with correct syntax, demonstrating successful memorisation and
parameter alignment.

**Out-of-distribution query** ("What are the annotations found in the BrandingResult
Java class?"): the model returned a plausible-looking class with correct field names
and getter/setter structure, but:
- It omitted the class constructor.
- Variable names were internally consistent but incorrect.
- The response answered the class structure rather than specifically the annotations.

The conclusion was partial success: the tuning process demonstrably shifted the
model's output toward the RBP codebase, but further iterations are needed. Candidate
next steps included improving the instruction quality in the training dataset,
adjusting the prompt template, increasing the parameter count of the base model,
or modifying hyperparameters such as epoch count or learning rate.

---

## 9. Hyperparameters and iteration discipline

### 9.1 What hyperparameters control

Hyperparameters are configuration values set before training begins that shape the
training process without being learned by the model. Key examples:

- **`num_epochs`**: how many complete passes over the training dataset to perform.
  More epochs can improve alignment but risk overfitting (the model memorises training
  examples rather than generalising).
- **`learning_rate`**: the step size applied to weight updates based on the loss signal.
  A high rate converges faster but may overshoot the optimal weights; a low rate is
  stable but slow.
- **LoRA rank** (`r`): the dimensionality of the LoRA adapter matrices. Higher rank
  means more adapter parameters and potentially higher accuracy but slower training
  and larger adapter files.

### 9.2 Why fine-tuning is inherently iterative

No single combination of dataset, base model, prompt template, and hyperparameters
is optimal on first attempt. The chapter is explicit that experienced teams run multiple
fine-tuning experiments in parallel — varying one or two factors per run — and compare
results before committing to a configuration.

The practical implication: fine-tuning projects need:
- Version control for dataset files and YAML configurations.
- A systematic log of which configuration produced which loss curve and evaluation
  score.
- A parallel-run strategy to avoid spending weeks on sequential experiments.

---

## 10. Anti-patterns

### 10.1 Fine-tuning for problems that RAG solves

If the goal is to give a model access to a corpus of documents that will change over
time, RAG (Chapter 11) is cheaper and more maintainable. Fine-tuning bakes knowledge
into weights; updating that knowledge requires a new training run. RAG externalises
knowledge into a queryable corpus that can be updated without retraining.

### 10.2 Insufficient or poorly structured training data

Small datasets can fine-tune a model, but the success boundary depends on the quality
of each entry, not just the count. Line-by-line code parsing (each line as one entry)
produced worse results than semantic-unit parsing (each method or class as one entry)
despite having more rows. More rows of low-quality data can be worse than fewer rows
of high-quality data.

### 10.3 Using purely synthetic training data

Synthetic data is useful as a supplement, especially when real examples of rare patterns
are needed. But models trained exclusively on synthetic data lose the natural variance
of real-world examples, which degrades generalisation. The risk is subtle because the
model can appear to perform well on synthetic evaluation data while failing on real
queries.

### 10.4 Skipping the evaluation step

Fine-tuning without a structured evaluation phase — automated inference testing and/or
human validation — produces a model of unknown quality. Loss curves during training
are necessary but not sufficient: a low training loss can coexist with poor
generalisation (overfitting) or hallucination on novel prompts.

### 10.5 Ignoring context length during dataset curation

Dataset entries that overflow the model's context length are silently truncated during
tokenisation. The truncated portion never contributes to training, and entries that are
consistently truncated may mislead the model about expected response completeness.
Context-length auditing should be a mandatory step in dataset preprocessing.

### 10.6 Underestimating infrastructure and cost

Fine-tuning requires dedicated GPU time. Even a modest experiment on a 7B model
with a small dataset takes tens of minutes on a high-end consumer GPU. Larger models,
larger datasets, or more epochs multiply that cost. Teams that do not budget for
iteration cycles will be forced to treat the first fine-tuned model as final regardless
of quality.

---

## 11. Aegis-specific mapping

### 11.1 v1 posture — fine-tuning is not a priority

For Aegis v1, fine-tuning is not a priority. The system's knowledge base is growing,
the domain vocabulary is still being established, and the `knowledge/` corpus is the
primary mechanism for domain specificity. RAG-style prompt injection (using the
`qa-knowledge-librarian` to retrieve relevant chapters) is the appropriate v1 strategy.

The chapter's framing reinforces this: RAG is the right tool when the knowledge base
is actively changing. Aegis's `knowledge/` folder is edited regularly as new chapters
are ingested. Fine-tuning that knowledge into weights would require a new training run
for every substantive addition.

### 11.2 v2/v3 — when fine-tuning becomes plausible

Two conditions would make fine-tuning worth exploring for Aegis in a later version:

1. **A stable corpus of high-quality QA judgements**: if the `qa-curator` accumulates
   a large set of confirmed SPV (single-point-of-value) reviews that have been promoted
   into `lessons.json`, that corpus represents labelled instruction-output pairs.
   An instruction might be "Given this test artefact and context, what is the QA
   risk?" and the output the curator's verified judgement. Fine-tuning a smaller,
   faster model on that corpus would produce a "QA-judgement model" tuned to
   Aegis's specific evaluation style.

2. **Latency or cost constraints on the orchestrator**: if the `qa-orchestrator`
   reaches a scale where per-call RAG injection is expensive or slow, a fine-tuned
   model that has absorbed common domain patterns into its weights would reduce
   the need for retrieval on high-frequency query types.

### 11.3 Training-data curation discipline applies now

Even before fine-tuning is pursued, the dataset-curation discipline the chapter
describes applies directly to how Aegis maintains `lessons.json` and handles curator
promotions:

- **Semantic granularity**: each lesson entry should represent a single, coherent
  insight — not a dump of raw session output. This mirrors the semantic-unit parsing
  approach that outperformed line-by-line parsing.
- **Instruction-output pairing**: lessons that record both the situation (instruction)
  and the validated judgement (output) are immediately usable as fine-tuning rows.
  Lessons that record only observations without grounded conclusions are not.
- **Quality over quantity**: a smaller set of precisely curated lessons is more
  valuable than a large set of ambiguous or unreviewed ones. The Alpaca dataset
  (52k rows) competes with datasets ten times larger because of its structural
  consistency.
- **Provenance tracking**: knowing which session, agent, and review process
  produced each lesson is the equivalent of tracking dataset sources — essential
  for auditing and for deciding which entries to remove if quality problems surface.

### 11.4 Which agents are most relevant

**`qa-orchestrator`**: would be the primary consumer of a fine-tuned model if one
were deployed. It generates test strategies and orchestrates agent calls; a model
fine-tuned on Aegis's QA vocabulary and judgement patterns would reduce the prompt
engineering burden on the orchestrator.

**`qa-curator`**: is both a potential beneficiary of fine-tuning and the primary
producer of training data. Each SPV review the curator confirms is a candidate
training row. The curator's promotion workflow — triaging raw observations into
`lessons.json` — is functionally equivalent to dataset curation as described in
Section 12.2.1 of the chapter.

---

## 12. Practical patterns for QA use

### Pattern A — Code-intelligence assistant for test automation

A team with a large test automation codebase (e.g., a Playwright or Selenium suite
spanning hundreds of page objects) could fine-tune a model on the automation layer.
The dataset would pair questions about page-object structure, helper methods, and
configuration with the actual source code as output. The resulting model answers
"how does the login step work in our framework?" without needing to retrieve files
at query time.

The chapter's RBP example is a direct template for this pattern. It would need to
be adapted to handle JavaScript/TypeScript rather than Java (the tokeniser and
base model selection would differ accordingly).

### Pattern B — Domain-specific defect classifier

A team with a historical defect log can structure the log as instruction-output pairs
where the instruction is a bug description and the output is the defect category,
component, or root-cause classification the team has previously assigned. Fine-tuning
a classification model on this data would automate triage with terminology specific
to the team's taxonomy — something a generic LLM cannot do accurately.

### Pattern C — Parallel experiment tracking from day one

Even exploratory fine-tuning sessions benefit from a structured log. Before running
any tuning job, record the dataset version, base model, prompt template hash, epoch
count, and learning rate. After the run, record the final loss and a summary of human
validation findings. This log is the foundation for the parallel-run strategy the
chapter recommends for mature teams.

---

## 13. Summary

- **Fine-tuning** continues a foundational model's training on a small, domain-specific
  labelled dataset, shifting its weights toward desired behaviours without starting
  from scratch.
- **Goal clarity** drives every subsequent decision: which data to collect, which base
  model to select, how to structure the prompt template, and how to measure success.
- **Dataset quality dominates** fine-tuning outcomes. Semantic-unit granularity
  (one coherent concept per row) consistently outperforms line-by-line or arbitrary
  chunking.
- **JSONL** is the standard training data format: one JSON object per line with
  `instruction` and `output` keys at minimum.
- **Tokenisation** converts text to model-specific token IDs; using the wrong tokeniser
  or exceeding the context length silently corrupts the training signal.
- **LoRA (PEFT)** makes fine-tuning accessible on consumer hardware by training small
  adapter matrices rather than all model weights.
- **Axolotl** wraps the fine-tuning loop in a YAML-configurable framework, removing
  the need for low-level PyTorch experience when getting started.
- **Evaluation requires both automated inference** (sentiment scoring on a held-out
  dataset) and **human validation** (manual probing with novel prompts).
- **Fine-tuning is iterative**: dataset, prompt template, base model, and
  hyperparameters all interact; parallel experiment runs and systematic logging are
  necessary for efficient exploration.
- **For Aegis v1**: RAG and prompt engineering are sufficient; fine-tuning is not a
  priority. The dataset-curation discipline applies immediately to `lessons.json`
  and curator promotions.
- **For Aegis v2/v3**: a corpus of confirmed SPV reviews could seed a "QA-judgement"
  fine-tune that embeds Aegis's evaluation vocabulary and patterns into model weights.

---

## Cross-references

- `[[ch-10-introducing-customized-llms]]` — survey of the customisation spectrum
  (prompt engineering → RAG → fine-tuning → full training); provides the conceptual
  framework this chapter operates within.
- `[[ch-11-contextualizing-prompts-with-rag]]` — the alternative to fine-tuning when
  the knowledge base is actively changing or transparency/provenance are required;
  Aegis v1's primary customisation mechanism.
- `[[ch-09-ai-agents-as-testing-assistants]]` — agent architectures that would
  consume a fine-tuned model as their reasoning core.
- `[[ch-02-llms-and-prompt-engineering]]` — prompt structure techniques (templates,
  delimiters, instruction phrasing) that the fine-tuning prompt template builds on.
- `[[ch-06-rapid-data-creation-using-ai]]` — synthetic data generation for testing;
  the same tools and cautions apply to generating synthetic fine-tuning data.
- `[[ch-01-enhancing-testing-with-llms]]` — foundational framing of LLM capabilities
  and limitations that explain why domain-specific tuning improves output quality.
