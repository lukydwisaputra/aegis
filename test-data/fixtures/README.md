# test-data/fixtures/

Static binary/JSON/CSV/image fixtures that tests upload, compare, or render.

Committed to git (small files only — keep this folder under 10 MB total).

## Layout

```
fixtures/
├── sample-images/
│   ├── valid-jpeg-1mb.jpg
│   ├── valid-png-transparent.png
│   └── oversized-50mb.jpg              # for upload-limit tests
├── sample-uploads/
│   ├── sample.csv
│   ├── sample.pdf
│   └── invalid.exe                     # for content-type rejection tests
├── golden/                              # expected outputs for snapshot tests
│   └── (per-test golden files)
└── README.md
```

## Guidelines

- Keep individual fixtures under 1 MB where possible
- Document non-obvious fixtures (e.g., why `invalid.exe` exists)
- Large or generated fixtures should live in S3/storage with a checksum reference, not here
- Binary fixtures must be reproducible (don't lose the source if a vendor changes)
