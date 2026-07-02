import type { Rule } from 'eslint';
type Plugin = { rules?: Record<string, Rule.RuleModule>; [key: string]: unknown };

// ---------------------------------------------------------------------------
// Rule 1: no-raw-page-in-e2e
// QA spec files (*.spec.ts under tests/qa/**) must import `test` from the
// auth fixture, not from @playwright/test directly.
// ---------------------------------------------------------------------------
const noRawPageInE2e: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'E2E spec files must import `test` from the auth fixture, not directly from @playwright/test',
      recommended: true,
    },
    hasSuggestions: true,
    messages: {
      noRawImport:
        'Do not import `test` from "@playwright/test" directly in spec files. Use the auth fixture instead.',
      suggestFix:
        'Replace with: import { test } from \'tests/qa/fixtures/auth.fixture\'',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    const normalized = filename.replace(/\\/g, '/');
    const isQaSpecFile =
      normalized.endsWith('.spec.ts') && normalized.includes('tests/qa/');

    if (!isQaSpecFile) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@playwright/test') return;

        const importsTest = node.specifiers.some(
          (spec) =>
            spec.type === 'ImportSpecifier' &&
            spec.imported.type === 'Identifier' &&
            spec.imported.name === 'test',
        );

        if (!importsTest) return;

        context.report({
          node,
          messageId: 'noRawImport',
          suggest: [
            {
              messageId: 'suggestFix',
              fix(fixer) {
                // Replace just the source string
                return fixer.replaceText(
                  node.source,
                  "'tests/qa/fixtures/auth.fixture'",
                );
              },
            },
          ],
        });
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Rule 2: no-sandbox-import
// Disallow importing from aegis/sandbox/ paths into non-sandbox source files.
// ---------------------------------------------------------------------------
const noSandboxImport: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow importing from sandbox/ paths in non-sandbox source files',
      recommended: true,
    },
    messages: {
      noSandboxImport:
        'Importing from a sandbox path ({{importPath}}) is not allowed in non-sandbox files.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    const fileIsInSandbox = filename.includes('/sandbox/');

    function checkSource(node: Rule.Node, source: string) {
      const isSandboxImport =
        source.includes('/sandbox/') || source.startsWith('sandbox/');

      if (isSandboxImport && !fileIsInSandbox) {
        context.report({
          node,
          messageId: 'noSandboxImport',
          data: { importPath: source },
        });
      }
    }

    return {
      ImportDeclaration(node) {
        checkSource(node as unknown as Rule.Node, String(node.source.value));
      },
      CallExpression(node) {
        // require('sandbox/...')
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length > 0
        ) {
          const arg = node.arguments[0];
          if (arg && arg.type === 'Literal' && typeof arg.value === 'string') {
            checkSource(node as unknown as Rule.Node, arg.value);
          }
        }
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Rule 3: no-brand-leak-in-class-b
// Lint-time mirror of the brand-exposure check for class B artifacts.
// Reports string literals in files inside runs/ directories that contain
// forbidden brand strings ("aegis", "qa-orchestrator", etc.).
// ---------------------------------------------------------------------------
const noBrandLeakInClassB: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prevent brand strings (e.g. "aegis", "qa-orchestrator") from leaking into class B artifacts (runs/ directory)',
      recommended: false,
    },
    messages: {
      brandLeak:
        'Brand string "{{value}}" detected in a class B artifact. Remove or mask brand references.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    // Only active for files inside runs/ directories (class B artifacts)
    const isClassBFile = /[/\\]runs[/\\]/.test(filename);

    if (!isClassBFile) {
      return {};
    }

    const BRAND_RE = /\baegis\b|qa-orchestrator|qa-dept/i;

    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (BRAND_RE.test(node.value)) {
          context.report({
            node,
            messageId: 'brandLeak',
            data: { value: node.value },
          });
        }
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Rule 4: no-non-qa-write-to-aegis
// Prevents non-qa-* agents from writing to aegis/ paths.
// Flags calls to writeFileSync / appendFileSync where the path argument
// contains '/aegis/' in files that are NOT inside aegis/packages/ or aegis/apps/.
// ---------------------------------------------------------------------------
const noNonQaWriteToAegis: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prevent write calls targeting /aegis/ paths from outside aegis/packages/ or aegis/apps/',
      recommended: false,
    },
    messages: {
      noNonQaWrite:
        'Writing to an aegis/ path ({{path}}) is not permitted from outside the aegis package tree.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();

    // Files inside aegis/packages/ or aegis/apps/ are allowed
    const isInAegisTree =
      filename.includes('/aegis/packages/') ||
      filename.includes('/aegis/apps/');

    if (isInAegisTree) {
      return {};
    }

    const WRITE_FNS = new Set(['writeFileSync', 'appendFileSync']);

    return {
      CallExpression(node) {
        // Match writeFileSync(path, ...) and appendFileSync(path, ...)
        let calleeName: string | null = null;

        if (node.callee.type === 'Identifier') {
          calleeName = node.callee.name;
        } else if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier'
        ) {
          calleeName = node.callee.property.name;
        }

        if (!calleeName || !WRITE_FNS.has(calleeName)) return;

        const firstArg = node.arguments[0];
        if (!firstArg || firstArg.type !== 'Literal') return;
        if (typeof firstArg.value !== 'string') return;

        if (firstArg.value.includes('/aegis/')) {
          context.report({
            node,
            messageId: 'noNonQaWrite',
            data: { path: firstArg.value },
          });
        }
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Plugin export (CommonJS)
// ---------------------------------------------------------------------------
const plugin: Plugin & {
  configs: {
    recommended: {
      plugins: string[];
      rules: Record<string, string>;
    };
  };
} = {
  rules: {
    'no-raw-page-in-e2e': noRawPageInE2e,
    'no-sandbox-import': noSandboxImport,
    'no-brand-leak-in-class-b': noBrandLeakInClassB,
    'no-non-qa-write-to-aegis': noNonQaWriteToAegis,
  },
  configs: {
    recommended: {
      plugins: ['@qa/eslint-plugin'],
      rules: {
        '@qa/eslint-plugin/no-raw-page-in-e2e': 'error',
        '@qa/eslint-plugin/no-sandbox-import': 'error',
        '@qa/eslint-plugin/no-brand-leak-in-class-b': 'warn',
        '@qa/eslint-plugin/no-non-qa-write-to-aegis': 'warn',
      },
    },
  },
};

module.exports = plugin;
