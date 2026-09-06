# Recall Chrome Extension

> **AI-powered semantic search for your browsing history -- runs 100% locally in your browser.**

Search your visited web pages by **meaning and concepts** of what you remember, not just exact keyword matches. No cloud servers, no API keys, no external requests, and zero data leaves your device.

---

## Key Features

- **Semantic Meaning Search**: Find pages even if you do not remember the exact words. Searching for `machine learning optimization` finds articles discussing gradient descent or neural network training.
- **100% On-Device & Private**: All embeddings and searches run entirely inside your browser using WebAssembly (WASM) and ONNX Runtime. Your browsing data never leaves your device.
- **Smart Text Chunking**: Long articles and documents are split into overlapping semantic chunks (up to 5 chunks per page) so every important section is indexed and searchable.
- **HNSW Fast Vector Index**: Uses Hierarchical Navigable Small World (HNSW) graph indexing alongside Cosine Similarity for fast vector search directly in JavaScript.
- **Filter Controls**: Filter search results dynamically by domain (e.g. `github.com`, `medium.com`) or by time range (Today, Past 7 Days, Past 30 Days, All Time).
- **First-Time Setup Onboarding**: Interactive setup screen with live model download progress indicator and warm-up test.
- **Data Portability**: Full IndexedDB database export and import functionality (JSON format) for easy backup and migration.
- **Non-Intrusive Capture**: Automatically extracts clean article text, stripping out navigational bars, footers, sidebars, and ads.

---

## How It Works

Recall executes an end-to-end semantic search pipeline inside Chrome:

```
[ Web Page Visited ]
         |
         v
[ content.js ] --------> Extracts clean article text (DOM filtering)
         |
         v
[ background.js ] -----> Splits text into overlapping semantic chunks
         |
         v
[ offscreen.html / offscreen.js ] --> Generates 384-dimensional vector embeddings
         |                            (Transformers.js + ONNX Runtime + WASM)
         v
[ db.js (IndexedDB) ] -> Stores page metadata + chunk vectors locally
         |
         v
[ popup.html / popup.js ] -> User enters semantic query --> Computes similarity
                             (HNSW Vector Index & Cosine Similarity) --> Displays ranked results
```

---

## Core Technologies

### 1. all-MiniLM-L6-v2 (Embedding Model)
- **Architecture**: Compact 6-layer Transformer with 384-dimensional output embeddings.
- **Efficiency**: Quantized to ~23MB ONNX format for fast browser execution and minimal memory footprint.
- **Purpose**: Maps text sentences and paragraphs into a dense vector space where semantically similar concepts are located close to each other.

### 2. ONNX Runtime Web & WebAssembly (WASM)
- **ONNX (Open Neural Network Exchange)**: An open standard format built to represent machine learning models across different hardware and platforms.
- **WASM with SIMD**: Executes high-performance compiled C++/assembly code inside the browser sandbox at near-native speed, taking advantage of SIMD (Single Instruction, Multiple Data) CPU vector acceleration.

### 3. Transformers.js
- Runs Hugging Face transformer pipelines directly inside client-side JavaScript environments without requiring Node.js or Python backend servers.

### 4. IndexedDB & HNSW Indexing
- **IndexedDB**: Persistent client-side structured storage for page metadata, titles, URLs, timestamps, and float32 embedding vectors.
- **HNSW Graph**: Builds a multi-layer graph for fast approximate nearest neighbor (ANN) search across your stored vectors.

---

## Project Structure

```
recall-extension/
|-- manifest.json        # Chrome Extension Manifest (MV3)
|-- background.js        # Service worker: capture coordination, chunking & DB storage
|-- content.js           # Content script: clean DOM article text extraction
|-- offscreen.html       # Offscreen document host for ML execution
|-- offscreen.js         # Transformers.js model loader & embedding pipeline
|-- db.js                # IndexedDB database operations & vector storage
|-- hnsw.js              # Hierarchical Navigable Small World vector search index
|-- similarity.js        # Cosine similarity mathematical utilities
|-- popup.html           # Main extension popup interface
|-- popup.css            # Modern dark glassmorphism popup styling
|-- popup.js             # Search handler, domain/date filters, import/export UI
|-- setup.html           # First-time onboarding & model download progress UI
|-- setup.css            # Setup page styles
|-- setup.js             # Setup logic & model warm-up initialization
|-- icons/               # Extension icons (16x16, 48x48, 128x128)
|-- lib/                 # Bundled local libraries & ONNX WASM binaries
```

---

## Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/backlashblitz/recall-extension.git
   ```

2. **Open Chrome Extensions**:
   - Open Google Chrome and navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle switch in the top-right corner).

3. **Load the Extension**:
   - Click **Load unpacked**.
   - Select the `recall-extension` directory.

4. **Initialize Model**:
   - The setup page will automatically open on first installation.
   - Click **Download & Initialize Model** to download and cache the ~23MB model locally.
   - Once initialized, you are ready to browse!

---

## Usage

1. **Browse the Web**: As you read articles, blog posts, documentation, and news, Recall automatically indexes their content locally.
2. **Open Search**: Click the Recall extension icon in your Chrome toolbar (or press your extension shortcut).
3. **Search Naturally**:
   - Type conceptual queries like *"how to center a div with flexbox"*, *"climate change mitigation strategies"*, or *"rust memory safety borrowing rules"*.
4. **Filter Results**:
   - Narrow down results by domain (e.g. `docs.python.org`, `dev.to`) or time range (e.g. `Past 7 Days`).
5. **Manage Data**:
   - Use the **Export Data** button in settings to back up your vector database as JSON.
   - Use **Import Data** to restore your history anytime.

---

## Privacy & Security

- **Zero Telemetry**: Recall does not collect, log, or track user activity.
- **No External Servers**: Model inference and search are 100% client-side.
- **No API Keys**: Runs without OpenAI, Anthropic, or external API dependencies.
- **Local Storage**: All history and vector representations are kept strictly in your local browser IndexedDB.

---

## License

MIT License. Feel free to use, modify, and contribute!
