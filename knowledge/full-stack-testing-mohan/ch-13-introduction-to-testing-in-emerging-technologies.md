---
book: full-stack-testing-mohan
chapter: 13
title: "Introduction to Testing in Emerging Technologies"
pages: "574-601"
topics:
  - emerging-tech
  - ai-ml-testing
  - model-testing
  - non-determinism
  - blockchain-testing
  - smart-contract-testing
  - iot-testing
  - ar-testing
  - vr-testing
  - hardware-testing
  - full-stack-testing
  - future-of-testing
applies_to_agents:
  - qa-orchestrator
  - qa-curator
  - qa-strategist
---

# Chapter 13 — Introduction to Testing in Emerging Technologies

> _A bonus chapter that extends the book's full-stack testing foundations into four emerging technology domains — AI/ML, blockchain, IoT, and AR/VR — each of which introduces testing challenges that go well beyond the web and mobile application norms covered in earlier chapters. The chapter is deliberately introductory: each domain deserves its own book, but the goal here is to equip practitioners with enough grounding to recognize the new problems and begin adapting their test strategies before these technologies become mainstream._

---

## Core Concepts

### The Emerging Technology Landscape

- Rapid technological change over the past decade has produced a broad set of buzzwords — AI, ML, blockchain, AR, VR, MR, IoT, bots — that can feel overwhelming to absorb all at once.
- A useful grouping of themes helps frame these technologies:
  - **Human-like interactions** — touch, voice, gesture (e.g., Fitbit, Alexa).
  - **Augmented intelligence** — smart assistants, personalized recommendations, chatbots.
  - **Platforms as standards** — data, services, and infrastructure abstracted into reusable, scalable platforms that underpin super-apps (Uber, WeChat, Grab, Gojek).
  - **Connected things** — devices (phones, watches, coffee machines) that communicate over the internet with each other and with humans.
- Most of these technologies are not yet mainstream, so testing skills for them are not immediate must-haves — but being prepared before the wave hits is wise.
- Thoughtworks' Seismic Shifts podcast and Looking Glass report are cited as sources for deeper exploration.

---

## Domain 1 — Artificial Intelligence and Machine Learning

### What It Is

- **Artificial intelligence (AI)** is a computer science subfield that aims to make machines perform tasks typically requiring human intelligence. Strong AI (a theoretical construct capable of doing anything a human can do) is the aspirational end state.
- **Machine learning (ML)** is the mechanism through which AI is exercised: computers are programmed to learn from experience (historical data) rather than following explicitly coded rules.
- Distinction: any program exhibiting human-like behavior is AI, but unless its behavior is automatically learned from data, it is not ML.

### How ML Works (Abusive Content Filter Example)

- **Traditional programming approach**: define explicit rules (banned keywords, known abuser IDs) and apply them. Fails because abusers rapidly evolve new words and create new accounts, making a rule-based solution inadequate in a non-deterministic problem space.
- **ML approach**: feed large volumes of labeled historical data (abusive vs. non-abusive) into a mathematical algorithm (the model). The model learns distinguishing features from the data — analogous to how a human child learns to recognize objects from repeated exposure.
- The workflow: collect data → label it → split into training set and test set → train the model → evaluate accuracy using the test set → deploy → continue training with new production data.
- **Supervised learning**: ML with labeled data. **Unsupervised learning**: ML with unlabeled data, where the algorithm discovers patterns autonomously.
- Popular ML frameworks: **scikit-learn**, **PyTorch**, **TensorFlow**.
- Domains of ML application: medicine, banking, social media, and continuously expanding.

### Testing ML Applications

ML applications typically use a service-based architecture where an ML component is integrated into services. In addition to standard service-oriented testing, the following ML-specific aspects must be covered:

#### 1. Validating Training Data

- Data quality is the primary determinant of model quality: poor input data produces a poor model.
- Training data is often sourced from public databases, web scraping, user inputs, and system logs — resulting in inconsistent formats, scales, and types (text, images, videos, GIFs, with varying sizes and file formats).
- Before feeding data to the model, it must be **cleaned, de-noised, and transformed into a standardized format**. This cleansing and transformation logic must be tested thoroughly.
- Example test cases:
  - When input data arrives with different numerical scales (decimals to exponentially large numbers), validate that logic correctly normalizes to a uniform scale.
  - When input data can contain null or empty values, validate that they are replaced with defaults or eliminated during cleaning.
- Domain-specific validation rules must also be tested (e.g., a character limit on social media posts).
- Unit tests for cleansing and transformation logic help automate these validations.

#### 2. Validating Model Quality

- Model quality is measured through metrics such as error rate, accuracy, confusion matrix, precision, and recall.
- **Precision**: the ratio of true positives to total predicted positives (true positives + false positives). A precision of 0.99 means 99 out of 100 posts flagged as abusive actually were abusive.
- **Recall**: the ratio of true positives to all actual positives (true positives + false negatives). A recall of 0.90 means 99 out of 110 truly abusive posts were correctly identified.
- ML frameworks have built-in features to compute these metrics.
- Tests can be written to fail the CI pipeline when a newly committed model version falls below acceptable metric thresholds.
- **MLflow** is an open source tool for tracking and viewing model performance across versions.

#### 3. Validating Model Bias

- Bias in training data percolates directly into model bias. A well-known example: Twitter's image-cropping ML algorithm was publicly criticized for preferring white individuals' faces over Black individuals', leading Twitter to abandon the feature.
- If training data over-represents a particular demographic, the model becomes biased toward that group.
- Both input data and the trained model must be tested for biases.
- **Facets** is an open source tool that allows visualization of patterns (and potential biases) within input data.

#### 4. Validating Integrations

- Integrations between the three layers — data layer to model layer, and model layer to API layer — must be tested using standard contract and integration testing approaches (cross-ref: `[[ch-03-automated-functional-testing]]`).

#### Continuous Delivery for ML (CD4ML)

- The discipline of Continuous Delivery for Machine Learning (CD4ML) applies CI/CD principles to ML model training, evaluation, and deployment pipelines.
- Referenced via colleagues' article on Martin Fowler's website.

---

## Domain 2 — Blockchain

### What It Is

- Blockchain can be understood as "the Internet of Money" — a platform for sharing anything of value (stocks, bonds, reward points, cryptocurrency) peer-to-peer, without a centralized intermediary.
- The name derives from its structure: every transaction creates a **block** containing transaction data chained to the previous block via a cryptographic hash of the prior block's content.
- If any block's content is altered, the next block's hash no longer matches, breaking the chain — making existing transactions **immutable**.
- High-end cryptography (e.g., SHA-256 hashing) makes the chain resistant to tampering.
- Origins trace to Satoshi Nakamoto's 2008 whitepaper "Bitcoin: A Peer-to-Peer Electronic Cash System," which proposed digital money transferable without banks.

### Key Blockchain Concepts

#### Decentralized Ledgers

- A ledger holds all accounting data (inflows and outflows). In blockchain, the ledger is not owned by a single party — all participants hold a copy.
- Advantage: no single party can manipulate records. Cost: all ledgers must remain in sync continuously.

#### Nodes

- A node is any computer or server participating in the blockchain network; each node stores a copy of the decentralized ledger.
- When a new transaction occurs, each node updates its copy. Nodes communicate to keep ledgers synchronized using **Distributed Ledger Technology (DLT)**.

#### Consensus

- Since all nodes are equal participants (no central authority like a bank), consensus algorithms determine which node earns the right to add a new block.
- **Proof of Work**: nodes compete to solve an extremely complex mathematical problem; the first correct solution earns the right to add the new block. Downside: requires enormous computational power.
- **Proof of Stake**: mining power is proportional to the amount of digital currency a node controls. Downside: wealthier nodes continue to accumulate privilege.
- When a node successfully adds a block, it is rewarded with digital currency (mining).

#### Smart Contracts

- The business logic required to complete a transaction is encoded as a **smart contract**, a copy of which is distributed to every node.
- Benefits: paperless transactions, elimination of intermediary commissions, and parties can transact independently.
- Example: Alice purchases tomatoes from Bob for 10 Ethereum. The smart contract holds Alice's payment until Bob delivers (evidenced by a scanned QR code); if delivery fails within a set period, funds are returned to Alice.

#### Blockchain Development Frameworks and Tools

- Development frameworks: **Ethereum**, **HyperLedger Fabric**, **Stellar**.
- Smart contract languages/libraries: **Solidity**, **OpenZeppelin**.
- Digital wallet: **MetaMask** (for Ethereum).
- Testing tools: **Ethereum Tester**, **Populus** (for Ethereum-based apps); **bitcoinj**, **testnet** (for Bitcoin transactions).

### Testing Blockchain Applications

#### Standard Application Layer Tests

1. **Functional testing**: validate end-to-end functional flows (e.g., the purchase workflow) and specifically test for loopholes in smart contract logic. Smart contract test cases can be written as unit tests.
2. **API testing**: APIs sitting above the blockchain and connecting to frontends require standard API layer testing — functionality, module integrations, contract versioning, error handling, and retries.
3. **Security testing**: account creation and authorization, currency exchange integrity, account balance accuracy, detection of illegitimate transactions, and cryptographic hashing of blocks.
4. **Performance testing**: transaction completion time is inherently longer due to consensus algorithm overhead and intermittent node availability. Both transaction latency and functional behavior under delays must be tested. (Note: Visa reportedly processes ~1,700 transactions per second; a single blockchain transaction confirmation may take ~10 minutes.)

#### Blockchain-Specific Tests (When Testing the Chain Itself)

Most applications deploy onto existing networks (e.g., Ethereum) and need not test the network's own features. However, when building or validating a blockchain network directly, additional test areas apply:

- **Addition of transactions**: every transaction must be recorded without loss, blocks correctly chained and synced to all nodes.
- **Block size**: validate that a new block is created when the current block reaches its size limit (e.g., 1 MB in Bitcoin's original design).
- **Chain size**: test application performance as the chain grows very large.
- **Node testing**: nodes must participate in consensus, stay in sync, and new nodes must join the network seamlessly.
- **Resiliency**: after a temporary outage, a rejoining node should integrate back smoothly without disrupting application functionality; when all nodes are unavailable, the application must handle the outage gracefully.
- **Collisions**: multiple nodes may simultaneously solve the mathematical problem and contest the right to add a block — collision scenarios must be tested.
- **Data corruption (Byzantine nodes)**: a Byzantine node misbehaves in the decentralized system, potentially corrupting data across nodes. Proven Byzantine-fault-tolerance mechanisms must be tested for correct behavior.

#### Trade-offs

- Strengths: strong security, fully digitized transactions, elimination of middlemen, resistance to monopoly.
- Weaknesses: massive computational and electrical power requirements; transaction confirmation latency (performance bottleneck); complexity of keeping all ledgers synchronized.

---

## Domain 3 — Internet of Things (IoT)

### What It Is

- IoT connects the physical world to the digital world, giving everyday "things" intelligence and enabling them to communicate with each other and with humans over the internet, and to react autonomously to environmental changes.
- Examples: smart thermostats that adapt to humidity and user preferences; smart home solutions (global market expected to surpass $53 billion in 2022); smart city solutions improving infrastructure, air quality, transportation, and energy consumption.
- IoT devices are provisioned with three core features:
  - **Sensors**: detect physical states (temperature, pulse rate, motion).
  - **Actuators**: trigger environmental changes (raise alarms on smoke detection, open/close valves).
  - **Communication mediums**: present information to users (digital displays, voice).
- Building a complete IoT solution requires both hardware and software skills: embedded software inside the hardware controls device functionality and relays data to users; external software aggregates and analyzes data from multiple devices to take collective actions.

### IoT Five-Layer Architecture

The five-layer model provides the broadest view of IoT integration complexity:

| Layer | Role | Key Technologies |
|---|---|---|
| **Perception** | Hardware reads physical data and transfers it upward | Passive (QR scanners), semi-passive, active components (smart actuators, wearables, GPS radios) |
| **Network** | Identifies devices on the internet; handles routing | IPv4, IPv6, RPL (Routing Protocol for Low-Power and Lossy Networks), WiFi, Zigbee, NFC, Bluetooth |
| **Middleware** | Service discovery; data extraction and delivery; core of the IoT solution | Avahi, Bonjour (service discovery); CoAP, MQTT (data exchange) |
| **Application** | End-user-facing layer (web/mobile app); aggregates, processes, stores data from devices | Standard web/mobile frameworks |
| **Business** | Analyzes aggregated data to improve services; internal/administrative use | Apache Spark, Apache Kafka (big data analytics) |

- IoT platforms like **AWS IoT** and **IBM Watson** combine capabilities across these layers to ease development.

### Testing IoT Applications

#### 1. Hardware/Software Integration

- End-to-end functionality depends on correct hardware-software integration; test with varied edge cases (e.g., smartwatch heartbeat sensor displaying correct count and handling recording errors gracefully).
- Integration tests should be repeated after new installations and after hardware or software upgrades.
- Hardware constraints — memory limits and battery capacity — must be factored into functional testing.

#### 2. Network Connectivity

- Connectivity between devices and with the cloud is a critical test concern.
- Devices supporting multiple protocols (WiFi and Bluetooth) must have each protocol tested independently.

#### 3. Interoperability

- Different IoT devices may follow different standards and protocols yet must exchange information seamlessly. For example, in a smart transportation solution, traffic sensors, accident detection services, and automatic routing systems must interoperate.
- Interoperability unlocks IoT's full potential but requires careful integration testing.

#### 4. Security and Privacy

- Some protocols (e.g., Z-Wave) are not inherently secure; additional lightweight security mechanisms (e.g., IPsec) must be employed and tested.
- Biometric and personal data stored in the cloud must be private by design; compliance with legal data-storage requirements must be tested (cross-ref: `[[ch-10-cross-functional-requirements-testing]]`).

#### 5. Performance

- Many devices communicating simultaneously can stress the system. Key questions: how quickly does hardware respond to software commands? What is the overall response time for a service (e.g., reading pulse rate)? What is data collection performance under many simultaneously active devices (as in a smart city)?

#### 6. Usability

- Especially critical in the domestic sector (smartwatches, smart TVs). Test wrist-movement responses, varying display sizes, button/gesture combinations, alert systems (vibration, sound), left/right wrist wearing options, and user onboarding flows.

#### IoT Testing Atlas

- The author describes formulating a testing framework called the **IoT Testing Atlas** based on personal experience testing a smart coffee machine. It is designed to manage the large number of device state combinations and derive comprehensive test cases.

---

## Domain 4 — Augmented Reality and Virtual Reality

### What They Are

- **Augmented Reality (AR)**: superimposes digital graphics, text, images, and other sensory information onto the real-world environment to enhance the user's experience. Originally invented for military use (fighter pilots needing simultaneous target acquisition and flight awareness). Modern examples include Mercedes' HUD casting navigation and speed data onto a windshield.
- **Virtual Reality (VR)**: fully transports the user into a simulated virtual world, replacing their perception of the real environment entirely. Applications include gaming, hazardous environment simulation (fire, air attacks) for training, commercial product customization (designing house interiors), and virtual dressing rooms.

### AR Hardware Ecosystem

- Smart glasses/HUDs: Google Glass, Vuzix, Epson, Nreal.
- AR-enabled smartphones: the most accessible AR platform. Both Android and iOS support AR through:
  - **ARCore** (Google/Android).
  - **ARKit** (Apple/iOS).
  - **Unity's AR Foundation** (cross-platform).
  - Compatible devices include Pixel 5, Nokia 8, Moto G.

---

## Techniques and Templates

### For AI/ML Testing

- **Data pipeline testing**: treat the cleansing/transformation pipeline as testable code with unit tests covering scale normalization, null/empty value handling, and domain-specific constraints.
- **Model evaluation gates in CI**: write tests that fail the pipeline if model precision, recall, accuracy, or other metrics fall below agreed thresholds when a new model version is submitted.
- **Bias audits**: visualize data distributions with Facets before training; test model outputs against protected demographic subsets to detect discriminatory patterns.
- **Integration contract tests**: use standard contract testing at the data-to-model and model-to-API boundaries (same approach as microservice contract testing).
- **CD4ML**: apply Continuous Delivery principles to the model training and deployment pipeline.

### For Blockchain Testing

- **Smart contract unit tests**: isolate and test the business logic embedded in smart contracts independently.
- **Transaction flow end-to-end tests**: validate the complete workflow from transaction initiation through consensus and final sync.
- **Blockchain-specific state tests**: write tests for block creation at size limits, node join/leave/sync, collision handling, and Byzantine fault scenarios.
- **Performance baselines**: establish acceptable transaction latency thresholds and test behavior when those are exceeded.

### For IoT Testing

- **Layer-by-layer test design**: align test cases to each of the five IoT layers — perception, network, middleware, application, business.
- **State-based combinatorial testing**: use a framework like the IoT Testing Atlas to enumerate device states and derive combinatorial test cases covering the most critical state transitions.
- **Protocol-specific tests**: test each supported communication protocol (WiFi, Bluetooth, Zigbee, NFC) independently; do not assume protocol equivalence.
- **Hardware constraint testing**: include memory and battery edge cases as explicit test conditions in functional test suites.
- **Post-upgrade regression**: run hardware/software integration tests after every firmware or software update.

### For AR/VR Testing

- Note: the source text is truncated before covering AR/VR testing specifics in depth. The introduction establishes the technology context (hardware ecosystems, ARCore, ARKit, Unity AR Foundation), but detailed testing techniques for AR/VR are not fully captured in the available source extract.

---

## Examples

### ML: Abusive Content Filter

- A social media platform needs to detect abusive posts. A rules-based approach (banned keywords, known user IDs) fails because abusers constantly evolve new words and create new accounts.
- The ML solution: label historical posts as abusive or non-abusive, train a model on that labeled dataset, evaluate precision (how many flagged posts are truly abusive) and recall (how many truly abusive posts were caught), then deploy and retrain continuously with new production data.

### Blockchain: Peer-to-Peer Tomato Purchase

- Alice buys tomatoes from Bob for 10 Ethereum. The smart contract holds Alice's payment, releases it to Bob when he delivers (proven by a scanned QR code), or returns it to Alice if delivery does not happen within a set time. Meanwhile, nodes compete to solve a mathematical problem and add the transaction block; the winning node is rewarded with digital currency.

### IoT: Smart Coffee Machine and Smart Heartbeat Monitor

- A fitness smartwatch triggers its embedded sensor to measure the user's heart rate, displays it on the wrist screen, and sends it to the cloud. A cloud service analyzes the pattern over time and instructs the device to raise an alarm when anomalies are found.
- The author notes first-hand experience testing a smart coffee machine, which involves a large number of device-state combinations requiring a systematic framework (the IoT Testing Atlas).

### AR: Mercedes HUD and Fighter Pilot Displays

- Early AR was used on jet fighter frontal displays so pilots could maintain situational awareness while targeting. A contemporary equivalent is Mercedes' HUD casting navigation data and speed limits onto the windshield, reducing the need to look away from the road.

---

## Pitfalls and Anti-Patterns

### AI/ML

- **Applying standard functional test automation directly to ML outputs**: ML model outputs are probabilistic, not deterministic. A test that asserts an exact output value will be brittle. Instead, validate model quality through statistical metrics (precision, recall, accuracy) and define acceptable thresholds.
- **Skipping training data validation**: assuming that "more data is better" without testing data quality leads to a garbage-in-garbage-out failure. Data cleansing and transformation logic is code and must be tested like code.
- **Ignoring bias testing**: collecting a large dataset without auditing its demographic distribution is a common oversight that results in discriminatory model behavior in production (the Twitter image-cropping incident being a high-profile example).
- **Treating the ML pipeline as a black box**: not instrumenting model versions with tracking tools (e.g., MLflow) makes it impossible to trace performance regressions to specific training changes.

### Blockchain

- **Not testing smart contract edge cases**: smart contracts encode the core business rules and are immutable once deployed on most networks. Loopholes must be found before deployment, not after. Treating smart contract testing like optional QA is a critical error.
- **Ignoring transaction performance requirements**: assuming blockchain will be fast enough for a use case without explicit performance testing is dangerous. The throughput and latency gap versus conventional web services is enormous (1,700 tx/sec for Visa vs. ~10 minutes per blockchain transaction confirmation).
- **Skipping Byzantine fault and collision tests**: these scenarios are rare but catastrophic when they occur; omitting them from test plans is a common oversight.

### IoT

- **Assuming software tests are sufficient**: IoT functionality is tightly coupled to hardware behavior. Testing only the software layer without validating the hardware-software integration misses an entire category of failures.
- **Ignoring interoperability between device types**: testing each device in isolation without verifying cross-device data exchange leaves integration failures undetected until production.
- **Overlooking privacy and compliance requirements**: collecting biometric data without testing for regulatory compliance (e.g., GDPR) creates legal risk. Privacy must be tested by design, not retrofitted.
- **Treating usability as secondary**: in consumer IoT (wearables, smart home devices), poor usability is a primary product failure. Gesture recognition, notification design, and onboarding flows must be explicitly tested.

### AR/VR

- Note: full anti-pattern catalog for AR/VR is not available from the source extract, as the text is truncated before that section is covered.

---

## Tools Catalog

| Domain | Tool / Framework | Purpose |
|---|---|---|
| AI/ML | scikit-learn | ML model training |
| AI/ML | PyTorch | ML model training |
| AI/ML | TensorFlow | ML model training |
| AI/ML | MLflow | Model performance tracking across versions |
| AI/ML | Facets (Google) | Visualizing patterns and biases in training data |
| Blockchain | Ethereum | Blockchain development and deployment platform |
| Blockchain | HyperLedger Fabric | Enterprise blockchain framework |
| Blockchain | Stellar | Blockchain development framework |
| Blockchain | Solidity | Smart contract programming language |
| Blockchain | OpenZeppelin | Smart contract library |
| Blockchain | MetaMask | Ethereum digital wallet |
| Blockchain | Ethereum Tester | Testing Ethereum-based applications |
| Blockchain | Populus | Testing Ethereum-based applications |
| Blockchain | bitcoinj | Testing Bitcoin transactions |
| Blockchain | testnet | Bitcoin transaction testing environment |
| IoT | AWS IoT | Managed IoT platform |
| IoT | IBM Watson | Managed IoT platform with analytics |
| IoT | Apache Spark | Big data processing (IoT business layer) |
| IoT | Apache Kafka | Streaming data processing (IoT business layer) |
| IoT | CoAP | Constrained Application Protocol for IoT data exchange |
| IoT | MQTT | Message Queuing Telemetry Transport for IoT |
| IoT | Avahi / Bonjour | IoT service discovery protocols |
| AR | ARCore | Google AR framework for Android |
| AR | ARKit | Apple AR framework for iOS |
| AR | Unity AR Foundation | Cross-platform AR development framework |

---

## Cross-Refs

- `[[foreword]]` — testing as a continuously evolving field, foundational mindset
- `[[ch-01-introduction-to-full-stack-testing]]` — first principles that underpin all new technology testing challenges
- `[[ch-02-manual-exploratory-testing]]` — exploratory techniques relevant when ML outputs are non-deterministic
- `[[ch-03-automated-functional-testing]]` — contract and integration testing approaches applied to ML and blockchain API layers
- `[[ch-04-continuous-testing]]` — CD4ML extends CI/CD principles into ML pipelines; blockchain CI gates on model metrics
- `[[ch-05-data-testing]]` — training data validation overlaps directly with data quality testing practices
- `[[ch-07-security-testing]]` — blockchain cryptography and smart contract security; IoT protocol security (IPsec, Z-Wave)
- `[[ch-08-performance-testing]]` — blockchain transaction throughput benchmarking; IoT multi-device load testing
- `[[ch-09-accessibility-testing]]` — AR/VR usability considerations parallel accessibility concerns
- `[[ch-10-cross-functional-requirements-testing]]` — IoT privacy and data compliance requirements (GDPR); legal obligations around biometric data
- `[[ch-11-mobile-testing]]` — AR-enabled smartphone testing (ARCore, ARKit); IoT device usability on mobile interfaces
- `[[ch-12-moving-beyond-first-principles]]` — soft skills and continuous learning framing that precedes this bonus chapter
