# CodeLapse Semantic Search Implementation Roadmap

> ⚠️ **EXPERIMENTAL FEATURE**: Semantic search is currently an experimental feature. Use it at your own risk. The functionality may change or have limitations in future releases.

## 📋 Overview

The semantic search feature will enable:

- Natural language search across all snapshots
- Code-aware chunking for more meaningful results
- Efficient vector storage and retrieval
- Seamless integration with existing snapshot management

## 🎯 Project Phases

### Phase 1: Foundation & Infrastructure

- [x] Add dependencies and configuration
- [x] Design and implement code chunking
- [x] Set up vector database integration
- [x] Create embedding service

### Phase 2: Core Functionality

- [x] Implement snapshot content processing
- [x] Build vector storage synchronization
- [x] Create search query processing
- [x] Develop background indexing

### Phase 3: User Interface

- [x] Design and implement search UI
- [x] Add search results visualization
- [x] Create result navigation tools
- [x] Integrate with snapshot exploration

### Phase 4: Optimization & Polish

- [x] Add caching and performance improvements
- [x] Implement monitoring and error handling
- [x] Add configurable settings
- [ ] Create documentation and examples

## 📝 Detailed Task Checklist

### Phase 1: Foundation & Infrastructure

#### 1.1 Dependencies & Configuration

- [x] Add dependencies to package.json
  ```json
  "@pinecone-database/pinecone": "^5.1.2",
  "@google/generative-ai": "^0.24.0"
  ```
- [x] Add configuration settings to package.json
  ```json
  "vscode-snapshots.semanticSearch.enabled": {
    "type": "boolean",
    "default": true,
    "description": "Enable semantic code search across snapshots"
  },
  "vscode-snapshots.semanticSearch.chunkSize": {
    "type": "number",
    "default": 200,
    "description": "Maximum token size for each code chunk"
  },
  "vscode-snapshots.semanticSearch.chunkOverlap": {
    "type": "number",
    "default": 50,
    "description": "Overlap between adjacent chunks in tokens"
  },
  "vscode-snapshots.semanticSearch.autoIndex": {
    "type": "boolean",
    "default": false,
    "description": "Automatically index snapshots in the background"
  }
  ```
- [x] Add command registration to package.json
  ```json
  {
    "command": "vscode-snapshots.searchSnapshots",
    "title": "Snapshots: Semantic Search",
    "icon": "$(search)"
  },
  {
    "command": "vscode-snapshots.indexForSemanticSearch",
    "title": "Snapshots: Index All Snapshots for Search",
    "icon": "$(database)"
  }
  ```
- [x] Add keybindings for semantic search
  ```json
  {
    "command": "vscode-snapshots.searchSnapshots",
    "key": "ctrl+alt+shift+f",
    "mac": "cmd+alt+shift+f"
  }
  ```

#### 1.2 Credentials Management

- [x] Create `src/services/credentialsManager.ts` for secure API key storage
- [x] Implement method to securely save Pinecone API key
- [x] Implement method to securely save Gemini API key
- [x] Create prompt for collecting credentials when needed
- [x] Add validation for API keys

##### Security Setup

- [x] Create `src/security.ts` with `initializeSecurity(context)` helper for SecretStorage operations
- [x] Add global `extensionContext` for SecretStorage in `security.ts`
- [x] Call `initializeSecurity(context)` in `activate` function (extension.ts)

#### 1.3 Code Chunking

- [x] Create `src/services/codeChunker.ts` for intelligent code splitting
- [x] Implement language detection based on file extension and content
- [x] Create AST-based chunking for supported languages:
  - [x] JavaScript/TypeScript using web-tree-sitter
  - [x] Java using java-parser
  - [x] Python using a custom parser or regex
- [x] Implement line-based chunking for unsupported languages
- [x] Add metadata extraction for:
  - [x] Function and class names
  - [x] Import statements
  - [x] Comment density
  - [x] Language-specific features
- [x] Implement controlled chunk overlap for context preservation
- [x] Add configuration for chunk size and overlap

#### 1.4 Pinecone Integration

- [x] Create `src/services/vectorDatabaseService.ts` for Pinecone integration
- [x] Implement index creation and management
- [x] Create vector upsert functionality
- [x] Implement vector query with metadata filtering
- [x] Add vector deletion for snapshot cleanup
- [x] Implement namespace management for snapshot organization
- [x] Add error handling and retry logic

### Phase 2: Core Functionality

#### 2.1 Embedding Service

- [x] Create `src/services/embeddingService.ts` for Gemini integration
- [x] Implement text embedding generation
- [x] Add batch processing for efficient API usage
- [x] Create caching to prevent redundant embedding generation
- [x] Add error handling for rate limits and API issues
- [x] Implement embeddings for search queries
- [x] Create context-enhanced formatting for code embeddings

#### 2.2 Semantic Search Service

- [x] Create `src/services/semanticSearchService.ts` to orchestrate search
- [x] Implement snapshot content extraction flow
- [x] Build vector storage synchronization
- [x] Create search query processing
- [x] Add index maintenance and cleanup
- [x] Implement result enhancing with context
- [x] Add score normalization and thresholds
- [x] Create background processing queue

#### 2.3 Snapshot Integration

- [x] Extend SnapshotManager to support semantic search:
  - [x] Add methods to access snapshot content for indexing
  - [x] Include cleanup of vectors when snapshots are deleted
  - [x] Add support for selective indexing
- [x] Implement hooks for:
  - [x] New snapshot creation
  - [x] Snapshot deletion
  - [x] Snapshot restoration

#### 2.4 Background Processing

- [x] Implement queue for background indexing
- [x] Create throttling mechanism to avoid overloading
- [x] Add progress tracking for long-running operations
- [x] Implement cancellation support
- [x] Create recovery mechanism for interrupted processes
- [x] Add telemetry for processing time and errors

### Phase 3: User Interface

#### 3.1 Search Commands

- [x] Register `vscode-snapshots.searchSnapshots` command
- [x] Register `vscode-snapshots.indexForSemanticSearch` command
- [x] Add command handlers to commands.ts
- [x] Integrate with existing command infrastructure
- [x] Add menu entries for search commands

#### 3.2 Search UI

- [x] Create `src/ui/semanticSearchWebview.ts` for search interface
- [x] Implement search input with:
  - [x] Natural language query field
  - [x] Language filters
  - [x] Date range filters
  - [x] Snapshot selection
  - [x] Relevance threshold adjustment
- [x] Create responsive webview layout
- [x] Add progress indicators for search operations
- [x] Implement error handling and user feedback

#### 3.3 Results Visualization

- [x] Implement result card layout with:
  - [x] Code snippet with syntax highlighting
  - [x] File path and location
  - [x] Snapshot details
  - [x] Relevance score
  - [x] Term highlighting
- [x] Add sorting options for results
  - [x] By relevance
  - [x] By date
  - [ ] By file path
- [x] Implement filtering for results
- [x] Create pagination or virtual scrolling for large result sets

#### 3.4 Navigation Integration

- [x] Add "Open File" action to results
- [ ] Fix "Compare with Current" functionality in webview (currently not working)
- [x] Create "Jump to Snapshot" flow
- [x] Add "See More Results" expansion
- [x] Implement history for recent searches
- [x] Create "Similar Code" discovery feature

### Phase 4: Optimization & Polish

#### 4.1 Performance Improvements

- [x] Implement caching of frequent searches
- [x] Add partial indexing for large repositories
- [x] Optimize chunk size based on performance metrics
- [x] Implement batched and parallel processing
- [x] Add smart scheduling for background operations
- [ ] Create progressive loading for large result sets

#### 4.2 Error Handling

- [x] Implement retry mechanisms for API calls
- [x] Add fallback strategies for service outages
- [x] Create user-friendly error messages
- [x] Add logging for troubleshooting
- [x] Implement recovery procedures
- [ ] Create diagnostic command for checking services

#### 4.3 Settings & Configuration

- [x] Implement settings UI for semantic search
- [x] Add configuration for:
  - [x] Enabling/disabling the feature
  - [x] API key management
  - [x] Chunk size and overlap
  - [x] Auto-indexing behavior
  - [x] Performance settings
- [x] Create configuration validation
- [x] Add migration for settings changes

#### 4.4 Documentation

- [x] Add JSDoc comments to all functions
- [x] Create README section for semantic search
- [x] Add example queries in UI
- [x] Create usage documentation
- [x] Add troubleshooting guide
- [x] Add documentation for security initialization and SecretStorage usage
- [x] Update extension marketplace page

## 🧪 Testing Guidelines

### Unit Tests

- [x] Create tests for code chunking strategies
- [ ] Test embedding generation functionality
- [x] Validate vector database operations
- [ ] Test search result processing

### Integration Tests

- [ ] Test end-to-end search workflow
- [x] Validate indexing pipeline
- [x] Test credential management
- [ ] Verify UI interactions

### Performance Testing

- [ ] Measure indexing speed for different repository sizes
- [ ] Test search latency under various conditions
- [ ] Evaluate memory usage during operations
- [ ] Verify background processing efficiency

## 🚀 Implementation Notes

### API Keys Management

- Use VS Code Secret Storage API for secure credential storage
- Never store API keys in plain text
- Implement graceful degradation when keys are unavailable
- Add clear error messages for authentication issues

### Chunking Strategy

- Prioritize semantic boundaries (functions, classes) when possible
- Balance chunk size and context preservation
- Use different strategies for different languages
- Consider file size when determining chunking approach

### Embedding Optimization

- Cache embeddings to reduce API calls
- Use batch processing to minimize requests
- Include metadata in embedding context for better results
- Implement rate limiting compliance

### Search Experience

- Prioritize result quality over quantity
- Provide meaningful context in search results
- Enable rapid navigation between results
- Maintain search history for quick access

## 📈 Metrics for Success

- **Indexing Performance**: Aim for indexing 100 files per minute
- **Search Latency**: Target < 2 seconds for search completion
- **Result Quality**: Aim for 80%+ relevance on benchmark queries
- **Memory Usage**: Keep peak memory under 500MB during operations
- **User Experience**: Measure task completion time for common searches

## 🛠️ Required Skills

- TypeScript and VS Code extension API
- Vector databases (Pinecone)
- Embedding models (Gemini)
- UI/UX design for developer tools
- Performance optimization

## 📅 Timeline

- **Week 1**: Complete Foundation & Infrastructure
- **Week 2**: Implement Core Functionality
- **Week 3**: Develop User Interface
- **Week 4**: Optimization & Polish

## 🚧 Potential Challenges

- API rate limits and costs
- Performance with large repositories
- Memory usage during indexing
- Handling very large code bases
- Maintaining index consistency with frequent snapshot changes
- Webview integration with comparison features

## 🔍 Future Enhancements

- Code similarity analysis between snapshots
- Semantic code clone detection
- Natural language explanation of code evolution
- Query enhancement with AI-powered suggestions
- Integration with other coding assistants

## 🐛 Known Issues & Pending Fixes

- Fix "Compare with Current" functionality in semantic search webview
- Improve snapshot comparison rendering in webview context
- Ensure consistent behavior between native and webview comparison features
