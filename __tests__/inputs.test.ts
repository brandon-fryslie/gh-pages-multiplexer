import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as core from '@actions/core';
import { parseInputs } from '../src/index.js';

vi.mock('@actions/core');

type InputMap = Record<string, string>;

function mockInputs(inputs: InputMap): void {
  vi.mocked(core.getInput).mockImplementation(
    (name: string, options?: core.InputOptions) => {
      // [LAW:dataflow-not-control-flow] mirror real @actions/core behavior:
      // when required=true and the value is empty, throw the same error shape.
      const value = inputs[name] ?? '';
      if (options?.required && value === '') {
        throw new Error(`Input required and not supplied: ${name}`);
      }
      return value;
    },
  );
}

const VALID: InputMap = {
  'source-dir': 'public',
  'target-branch': 'gh-pages',
  'ref-patterns': '*',
  'base-path-mode': 'base-tag',
  'base-path-prefix': '',
  token: 'ghs_xxx',
};

describe('parseInputs', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_REF = 'refs/heads/main';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws when source-dir is missing', () => {
    mockInputs({ ...VALID, 'source-dir': '' });
    expect(() => parseInputs()).toThrowError(
      /Input required and not supplied: source-dir/,
    );
  });

  it('throws when base-path-mode is invalid', () => {
    mockInputs({ ...VALID, 'base-path-mode': 'invalid' });
    expect(() => parseInputs()).toThrowError(/Invalid base-path-mode/);
  });

  it('accepts base-path-mode "base-tag"', () => {
    mockInputs({ ...VALID, 'base-path-mode': 'base-tag' });
    expect(parseInputs().basePathMode).toBe('base-tag');
  });

  it('accepts base-path-mode "rewrite"', () => {
    mockInputs({ ...VALID, 'base-path-mode': 'rewrite' });
    expect(parseInputs().basePathMode).toBe('rewrite');
  });

  it('splits and trims ref-patterns on commas', () => {
    mockInputs({ ...VALID, 'ref-patterns': 'v*, release-*' });
    expect(parseInputs().refPatterns).toEqual(['v*', 'release-*']);
  });

  it('returns empty refPatterns when ref-patterns is empty', () => {
    mockInputs({ ...VALID, 'ref-patterns': '' });
    expect(parseInputs().refPatterns).toEqual([]);
  });

  it('populates repo from GITHUB_REPOSITORY', () => {
    process.env.GITHUB_REPOSITORY = 'acme/widgets';
    mockInputs(VALID);
    expect(parseInputs().repo).toBe('acme/widgets');
  });

  it('populates ref from GITHUB_REF', () => {
    process.env.GITHUB_REF = 'refs/tags/v1.2.3';
    mockInputs(VALID);
    expect(parseInputs().ref).toBe('refs/tags/v1.2.3');
  });

  it('constructs full DeployConfig from valid inputs', () => {
    mockInputs({
      'source-dir': 'public',
      'target-branch': 'gh-pages',
      'ref-patterns': 'v*,release-*',
      'base-path-mode': 'rewrite',
      'base-path-prefix': '/my-repo',
      token: 'ghs_abc',
    });
    process.env.GITHUB_REPOSITORY = 'owner/repo';
    process.env.GITHUB_REF = 'refs/heads/main';

    expect(parseInputs()).toEqual({
      sourceDir: 'public',
      targetBranch: 'gh-pages',
      refPatterns: ['v*', 'release-*'],
      basePathMode: 'rewrite',
      basePathPrefix: '/my-repo',
      token: 'ghs_abc',
      repo: 'owner/repo',
      ref: 'refs/heads/main',
      version: '',
      widgetIcon: '',
      widgetLabel: '',
      widgetPosition: '',
      widgetColor: '',
      prBaseRef: '',
      cleanupVersions: [],
    });
  });

  it('accepts custom widget customization inputs', () => {
    mockInputs({
      ...VALID,
      'widget-icon': '<svg><circle/></svg>',
      'widget-label': 'Docs {version}',
      'widget-position': 'left 50%',
      'widget-color': '#10b981',
    });
    const cfg = parseInputs();
    expect(cfg.widgetIcon).toBe('<svg><circle/></svg>');
    expect(cfg.widgetLabel).toBe('Docs {version}');
    expect(cfg.widgetPosition).toBe('left 50%');
    expect(cfg.widgetColor).toBe('#10b981');
  });

  it('rejects invalid widget-position format', () => {
    mockInputs({ ...VALID, 'widget-position': 'down 20px' });
    expect(() => parseInputs()).toThrow(/widget-position/);
  });

  it('rejects invalid widget-color format', () => {
    mockInputs({ ...VALID, 'widget-color': 'orange' });
    expect(() => parseInputs()).toThrow(/widget-color/);
  });

  it('accepts base-path-mode: none', () => {
    mockInputs({ ...VALID, 'base-path-mode': 'none' });
    expect(parseInputs().basePathMode).toBe('none');
  });

  it('populates version from explicit input', () => {
    mockInputs({ ...VALID, version: 'v1.2.3' });
    expect(parseInputs().version).toBe('v1.2.3');
  });

  it('defaults version to empty string when not provided', () => {
    mockInputs(VALID);
    expect(parseInputs().version).toBe('');
  });
});
