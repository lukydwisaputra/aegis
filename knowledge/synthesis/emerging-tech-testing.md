---
topic: emerging-tech-testing
sources:
  - book: genai-testing-winteringham
    chapters: [1, 2, 3, 5, 6, 8, 9, 10, 11, 12]
    role: primary
  - book: full-stack-testing-mohan
    chapters: [13]
    role: complementary
ingestedAt: "2026-05-24"
---

# Emerging Technologies — Testing (Synthesis)

> Standard testing assumes deterministic, synchronous, software-only systems. Emerging technologies break one or more of those assumptions: ML and LLM outputs are probabilistic; blockchain transactions are slow by design and encode immutable business logic; IoT crosses the hardware-software boundary; AR/VR introduces spatial and perceptual dimensions. Winteringham (2025) is the canonical reference for AI/ML testing; Mohan provides stub coverage for blockchain, IoT, and AR/VR. The dominant emerging-tech testing concern for 2025+ teams is LLM-based systems — both testing them and testing with them.

## AI / ML systems

This is the canonical area for Aegis. Winteringham's *Software Testing with Generative AI* (Manning, 2025) is the reference work; Mohan provides the broader classical ML framing. Treat Winteringham as primary, Mohan as complementary.

### What breaks in standard testing (Mohan ch-13 + Winteringham ch-01)

- **ML model outputs are probabilistic, not deterministic.** Exact-value assertions produce intermittent failures unrelated to real defects. Standard functional automation applied directly to model outputs is the wrong tool.
- **LLM responses are non-deterministic by design.** Two identical prompts can yield different outputs even at `temperature: 0` across model versions. Testing the system requires statistical or semantic comparison, not equality.
- **Model behavior shifts over time** with data drift and model drift. A passing suite from last month may not reflect current model quality.
- **Hallucination is the LLM-specific failure mode** — confident, plausible-sounding output that is factually wrong (Winteringham ch-01). LLMs generate responses probabilistically, not by reasoning or verified knowledge. The book's opening example: ChatGPT recommending a book that does not exist.
- **Bias percolates from training data into outputs.** Twitter's image-cropping algorithm preferring white over Black faces (publicly criticized, eventually abandoned) is the canonical real-world incident.

---

### Classical ML testing dimensions (Mohan ch-13)

#### 1. Validating training data

Data quality is the primary determinant of model quality. Training data is often sourced from public databases, web scraping, user inputs, and system logs — inconsistent formats, scales, and types are the norm. Before feeding data to the model:

- Cleansing and transformation logic must be tested as code. Example test cases:
  - When input arrives with different numerical scales (decimals to exponentials), validate normalization to uniform scale.
  - When input can contain null/empty values, validate replacement with defaults or elimination.
- Domain-specific validation rules (character limits, allowed enumerations) must be tested.
- Unit tests for cleansing/transformation logic automate these validations.

#### 2. Validating model quality

Use statistical metrics, never exact-value assertions:

- **Precision**: TP / (TP + FP). 0.99 precision = 99 of 100 flagged items are correctly flagged.
- **Recall**: TP / (TP + FN). 0.90 recall = 99 of 110 truly positive items are correctly identified.
- **Accuracy, F1, confusion matrix, error rate.**
- Write CI gates that fail the build when a new model version falls below threshold (Mohan ch-13).
- **MLflow** (open source) tracks performance across model versions; without version tracking, regressions cannot be traced to specific training changes.

#### 3. Validating model bias

- Both input data and trained model must be audited.
- **Facets** (Google, open source) visualizes input data distributions and surfaces demographic imbalance before training.
- Test model outputs against protected demographic subsets to detect discriminatory patterns post-training.

#### 4. Validating integrations

- Data-layer → model-layer and model-layer → API-layer boundaries use standard contract and integration testing (Mohan ch-13).
- Apply CD4ML (Continuous Delivery for Machine Learning) so model updates move through the same CI/CD discipline as application code.

---

### LLM-augmented testing (Winteringham canon)

LLMs democratize AI: testers can now use AI without a data-science background (Winteringham ch-01). Their useful capabilities are summarize, transform, generate, translate. The value is not that LLMs replace tester judgment — it is that LLMs extend how far tester judgment can reach.

#### The Mindset–Technique–Context model

All three must be present; weakness in any one degrades the output (Winteringham ch-01):

- **Mindset**: clear sense of what testing is for, realistic view of LLM limits, choosing focused targeted uses.
- **Technique**: clear, specific, well-scoped prompts; response-format shaping; understanding when to use agents, APIs, or fine-tuning.
- **Context**: the LLM responds to what it is given. Provide context inline (role, scope, requirements), via RAG, or via fine-tuning.

#### Area-of-effect model

- An individual working alone is bounded by time, attention, and bias.
- A tool working alone has no direction.
- The highest output is achieved when a skilled tester uses tools to expand capability, not replace it.

The tester remains the center. The LLM extends reach; the tester provides direction, evaluation, judgment.

#### LLM application areas in testing

1. **Test data generation** (Winteringham ch-06): rapid, schema-constrained, format-conversion-capable; PII safety is mandatory. See `synthesis/test-data-generation.md`.
2. **Test planning and risk analysis** (Winteringham ch-05): SFDIPOT applied to LLM prompts surfaces risk classes a tester might miss. Modeling-before-prompting beats prompting cold.
3. **UI automation acceleration** (Winteringham ch-07): LLM for Playwright/Selenium scaffolding, page-object generation from DOM, locator-healing for changed UIs.
4. **Exploratory testing assistance** (Winteringham ch-08): divergent-thinking prompts, charter generation, mnemonic-driven idea expansion.
5. **AI agents as testing assistants** (Winteringham ch-09): orchestrator/SPV pattern, per-agent context accumulation via tool returns, tool-description quality as the leading determinant of agent reliability.
6. **AI-assisted developer testing** (Winteringham ch-04): Copilot for TDD, code review of AI output, IDE-integrated suggestions.

---

### Testing LLM-based systems

When the system under test is itself an LLM-based application (chatbot, summarizer, AI agent), conventional testing approaches do not transfer directly.

#### Strategies for non-deterministic outputs

- **Semantic similarity**: compare model output to expected output using embeddings (cosine similarity above a threshold) rather than exact match.
- **Structural validation**: parse output as JSON/Markdown/structured response; validate shape with Zod/Ajv/Pydantic; ignore the volatile content.
- **LLM-as-judge**: a separate (often larger) LLM evaluates whether the output satisfies criteria. Useful for subjective qualities (helpfulness, harmlessness) but introduces its own evaluation variance.
- **Rubric-based scoring**: human or LLM-as-judge scores output against an explicit rubric; aggregate scores trend over model versions.
- **Adversarial probing**: prompt-injection tests, jailbreak attempts, edge inputs designed to surface unsafe outputs.
- **Guardrail validation**: confirm that refusals fire for prohibited categories (PII extraction, harmful content) and do not fire for legitimate queries.

#### Hallucination as a testing target

Hallucination must be treated as a first-class failure mode, not a quirk (Winteringham ch-01):

- For RAG systems: validate that cited sources actually exist and contain the claimed content. Untraceable citations are the operational signal of hallucination.
- For factual claims: assert against a known-correct knowledge base.
- For generative outputs: log the prompt → response pair so hallucinations can be reviewed post-hoc.

#### Bias and fairness testing

- Build test sets that represent protected demographic groups proportionally.
- Compare model behavior across groups (precision, recall, refusal rate, sentiment).
- Significant divergence is a defect, not a feature.

#### Prompt-injection and security

LLM-based systems carry novel security risks:
- **Direct prompt injection**: user input contains instructions that override the system prompt.
- **Indirect prompt injection**: retrieved content (RAG documents, web pages, emails) contains malicious instructions.
- **Data exfiltration**: tricking the model into leaking system prompts or training data.

Test by constructing adversarial inputs and confirming guardrails hold.

---

### LLM customization paths (Winteringham ch-10, 11, 12)

When the off-the-shelf LLM is insufficient, three customization paths exist:

1. **Prompt engineering and context** (cheapest): inline role, structured input, RAG retrieval.
2. **RAG (Retrieval-Augmented Generation)** (medium): ingest → embed → retrieve → augment → generate. Keeps the LLM stateless but grounds responses in retrieved documents. The canonical pattern for domain-specific Q&A. See `synthesis/rag-and-knowledge-design.md`.
3. **Fine-tuning** (most invested): LoRA-based adaptation on domain-specific datasets. Dataset granularity matters more than dataset size. Suitable when the team has stable domain data and needs consistent format/tone the prompt cannot enforce reliably.

Each path has a context-window budget. Long prompts cost tokens and slow inference; RAG retrieval and fine-tuning shift work out of the runtime prompt.

---

### Tools

| Tool | Purpose |
|---|---|
| scikit-learn, PyTorch, TensorFlow | ML model training frameworks |
| MLflow | Model performance tracking across versions; CI integration |
| Facets (Google, open source) | Visualizing patterns and biases in training data |
| OpenAI / Anthropic / local model APIs | LLM access for testing AI features or augmenting test work |
| LangChain, LangChain4j, LlamaIndex | LLM application frameworks |
| Promptfoo, DeepEval | LLM evaluation and regression suites |
| Ragas | RAG-specific evaluation (faithfulness, context relevance) |
| LoRA / PEFT / RunPod | Cost-feasible fine-tuning infrastructure (Winteringham ch-12) |

---

## Blockchain

### What breaks in standard testing (Mohan ch-13)

- Transaction confirmation is inherently slow. Visa processes ~1,700 transactions per second; a single blockchain transaction confirmation may take ~10 minutes. Performance assumptions from conventional web service testing do not apply.
- Smart contracts encode business logic in code deployed to every node. On most networks, deployed contracts are **immutable** — defects cannot be patched post-deployment. Smart contract testing is the only opportunity to catch loopholes before they are locked in.

### Validated approaches

- Write unit tests for smart contract business logic in isolation before deployment. Cover the core state machine, edge cases, and common vulnerability patterns (reentrancy, integer overflow, gas limit exhaustion).
- Test end-to-end transaction flows from initiation through consensus to final ledger sync.
- Establish explicit performance baselines for transaction latency; test application behavior when those baselines are exceeded (graceful degradation).
- When testing a blockchain network itself (not just an app on an existing network), add tests for:
  - Block creation at size limits.
  - Node join/leave/sync behavior.
  - Collision handling when multiple nodes simultaneously solve the consensus problem.
  - Byzantine fault tolerance (a misbehaving node corrupting data across the network).

### Tools

| Tool | Purpose |
|---|---|
| Ethereum, HyperLedger Fabric, Stellar | Blockchain development platforms |
| Solidity, OpenZeppelin | Smart contract language and library |
| Ethereum Tester, Populus | Ethereum application testing |
| bitcoinj, testnet | Bitcoin transaction testing |
| MetaMask | Ethereum digital wallet for flow testing |

---

## IoT

### What breaks in standard testing (Mohan ch-13)

- IoT functionality is tightly coupled to hardware behavior. A test suite that passes against a simulator may fail against the actual device because sensors, actuators, memory limits, and battery constraints introduce failure modes software alone cannot reproduce.
- IoT solutions span five architectural layers, each with distinct protocols and failure modes. Testing only the application layer leaves perception, network, and middleware uncovered.

### IoT five-layer architecture

| Layer | Role | Representative technologies |
|---|---|---|
| Perception | Hardware reads physical data | QR scanners, wearable sensors, GPS radios |
| Network | Device identity and routing | IPv4/IPv6, WiFi, Zigbee, Bluetooth, NFC |
| Middleware | Service discovery; data exchange | CoAP, MQTT, Avahi, Bonjour |
| Application | End-user UI; data aggregation | Standard web/mobile frameworks |
| Business | Analytics; service improvement | Apache Spark, Apache Kafka |

### Validated approaches

- Align test cases to each layer independently. Application-layer pass does not imply perception/network-layer correctness.
- Test each supported communication protocol (WiFi, Bluetooth, Zigbee, NFC) in isolation.
- Include hardware constraints (memory, battery) as explicit test conditions.
- Re-run hardware/software integration tests after every firmware or software upgrade.
- Test interoperability across heterogeneous device types (traffic sensors + accident detection + routing systems must exchange data seamlessly despite differing standards).
- Test biometric and personal data handling for GDPR/PDPA compliance.
- For consumer IoT (wearables, smart home), treat usability as primary: gesture recognition, notification design, onboarding, varying form factors.

### Tools

| Tool | Purpose |
|---|---|
| AWS IoT, IBM Watson IoT | Managed IoT platforms |
| Apache Spark, Apache Kafka | Big-data processing at the business layer |
| CoAP, MQTT | IoT middleware protocols requiring dedicated test coverage |

---

## AR / VR

### What breaks in standard testing (Mohan ch-13)

- AR and VR introduce spatial accuracy, motion tracking, and perceptual dimensions with no direct equivalent in web/mobile testing.
- AR superimposes digital content on the real environment (Mercedes windshield HUD, fighter pilot displays). VR replaces the real environment entirely (training simulations, virtual customization).

### Validated approaches

- Test for spatial accuracy of overlaid digital content relative to real-world anchors.
- Test for motion-sickness triggers: frame rate drops, tracking latency, field-of-view mismatches are primary causes of simulator sickness.
- Test performance under tracking load across supported hardware (ARCore on Android, ARKit on iOS, Unity AR Foundation cross-platform).
- Note: Mohan's source text is truncated before AR/VR testing specifics in depth. This is a known gap; future source additions should fill it.

### Tools

| Tool | Purpose |
|---|---|
| ARCore (Google) | AR framework for Android |
| ARKit (Apple) | AR framework for iOS |
| Unity AR Foundation | Cross-platform AR development and testing |

---

## Pitfalls

### AI / ML and LLM systems

- **Treating model outputs as deterministic.** Assertion-based tests against probabilistic outputs produce false alarms and mask real quality trends. Use metric thresholds and statistical/semantic comparison (Mohan ch-13, Winteringham ch-01).
- **Skipping training data validation.** "More data is better" without quality checks is a path to discriminatory or unreliable models.
- **No statistical regression detection.** Without MLflow or equivalent, model regressions across versions are invisible.
- **Treating LLMs as an oracle of truth.** LLMs respond probabilistically, not factually. Hallucinated responses sound authoritative (Winteringham ch-01).
- **Accepting LLM responses uncritically because they feel human.** Natural-language fluency creates a trap. Apply the same scrutiny as to any information source.
- **Full delegation without context.** Minimal prompts produce minimal-context responses. The Mindset–Technique–Context model is mandatory.
- **Over-automation of test design.** LLMs can expand on ideas; they cannot originate the right ones without a human framing the problem first.
- **No prompt-injection / guardrail testing for LLM apps.** A novel security risk that conventional security testing does not cover.

### Blockchain

- **Skipping smart contract edge case testing.** Contracts are immutable once deployed; loopholes must be found beforehand.
- **Ignoring transaction performance requirements.** Latency is structural, not tunable. Test it explicitly before committing to the architecture.
- **Skipping Byzantine fault and collision tests.** Rare but catastrophic scenarios are systematically omitted from test plans.

### IoT

- **Assuming software tests are sufficient.** Hardware-software integration is an independent failure domain.
- **Treating IoT devices as equivalent.** Each device type and protocol must be tested independently.
- **Treating IoT usability as secondary.** For consumer devices, usability failures are primary product failures.

---

## Pointers

- Used by: qa-curator (for future v2/v3 specialist proposals); qa-orchestrator (meta-reference for Aegis itself, since Aegis is an LLM-agent system)
- Future v2 specialists: qa-ml-specialist, qa-llm-systems-specialist, qa-blockchain-specialist, qa-iot-specialist
- Cross-refs: `[[synthesis/prompt-engineering.md]]`, `[[synthesis/ai-agents-patterns.md]]`, `[[synthesis/rag-and-knowledge-design.md]]`, `[[synthesis/test-data-generation.md]]`, `[[synthesis/security-testing.md]]`
