import {
  isValidRef,
  isValidRepository,
  parseRefList,
  workflowSnippet,
} from '../githubOidc';

describe('githubOidc utils', () => {
  it.each(['octo/website', 'a/b', 'my-org/repo.name_1'])(
    'accepts repository %s',
    (repo) => expect(isValidRepository(repo)).toBe(true),
  );

  it.each(['octo', 'octo/', '/repo', '-octo/repo', 'a/b/c', 'octo/re po'])(
    'rejects repository %s',
    (repo) => expect(isValidRepository(repo)).toBe(false),
  );

  it.each([
    'refs/heads/main',
    'refs/tags/v*',
    'refs/*',
    'refs/heads/release/1.x',
  ])('accepts ref %s', (ref) => expect(isValidRef(ref)).toBe(true));

  it.each(['main', 'heads/main', 'refs/', 'refs/*/main', 'refs/heads/ma in'])(
    'rejects ref %s',
    (ref) => expect(isValidRef(ref)).toBe(false),
  );

  it('splits refs on lines, dropping blanks and duplicates', () => {
    expect(
      parseRefList(' refs/heads/main \n\nrefs/heads/main\nmain\n'),
    ).toEqual({
      entries: ['refs/heads/main', 'main'],
      invalid: ['main'],
    });
  });

  it('adds trust-id to the snippet only when given', () => {
    expect(workflowSnippet()).not.toContain('trust-id');
    expect(workflowSnippet('abc')).toContain('      trust-id: abc\n');
  });
});
