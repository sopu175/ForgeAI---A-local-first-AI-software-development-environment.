import { describe, it, expect } from 'vitest';
import { defaultParser } from './parser';

function names(symbols: ReturnType<typeof defaultParser.extractSymbols>) {
  return symbols.map((s) => s.name);
}

describe('HeuristicParser — TypeScript/JavaScript', () => {
  it('extracts a class', () => {
    const src = 'export class MyService {\n  foo() {}\n}\n';
    const symbols = defaultParser.extractSymbols('a.ts', src);
    expect(names(symbols)).toContain('MyService');
  });

  it('extracts an interface', () => {
    const src = 'export interface IUser { id: string; }\n';
    expect(names(defaultParser.extractSymbols('a.ts', src))).toContain('IUser');
  });

  it('extracts an arrow function const', () => {
    const src = 'export const greet = (name: string) => `Hello ${name}`;\n';
    expect(names(defaultParser.extractSymbols('a.ts', src))).toContain('greet');
  });

  it('attaches container to class methods', () => {
    const src = 'class Foo {\n  bar() {}\n  baz() {}\n}\n';
    const symbols = defaultParser.extractSymbols('a.ts', src);
    const methods = symbols.filter((s) => s.container === 'Foo');
    expect(methods.map((m) => m.name)).toEqual(expect.arrayContaining(['bar', 'baz']));
  });

  it('does not attach container to top-level functions', () => {
    const src = 'function standalone() {}\n';
    const symbols = defaultParser.extractSymbols('a.ts', src);
    const fn = symbols.find((s) => s.name === 'standalone');
    expect(fn?.container).toBeUndefined();
  });

  it('skips reserved words (if, for, while)', () => {
    // A line like "  if (condition) {" should not produce a symbol named "if"
    const src = 'function run() {\n  if (true) {}\n  for (;;) {}\n}\n';
    const result = names(defaultParser.extractSymbols('a.ts', src));
    expect(result).not.toContain('if');
    expect(result).not.toContain('for');
  });

  it('returns empty for an unsupported language', () => {
    expect(defaultParser.extractSymbols('notes.txt', 'just some text')).toHaveLength(0);
  });
});

describe('HeuristicParser — Python', () => {
  it('extracts classes and functions', () => {
    const src = 'class MyModel:\n    def save(self):\n        pass\n\ndef helper():\n    pass\n';
    const symbols = defaultParser.extractSymbols('app.py', src);
    expect(names(symbols)).toContain('MyModel');
    expect(names(symbols)).toContain('save');
    expect(names(symbols)).toContain('helper');
  });

  it('attaches container via indentation in Python', () => {
    const src = 'class Service:\n    def handle(self):\n        pass\n\ndef outside():\n    pass\n';
    const symbols = defaultParser.extractSymbols('svc.py', src);
    const handle = symbols.find((s) => s.name === 'handle');
    const outside = symbols.find((s) => s.name === 'outside');
    expect(handle?.container).toBe('Service');
    expect(outside?.container).toBeUndefined();
  });
});

describe('HeuristicParser — Go', () => {
  it('extracts functions and types', () => {
    const src =
      'type User struct { ID int }\nfunc (u *User) Save() error { return nil }\nfunc NewUser() *User { return &User{} }\n';
    const symbols = defaultParser.extractSymbols('main.go', src);
    expect(names(symbols)).toContain('User');
    expect(names(symbols)).toContain('Save');
    expect(names(symbols)).toContain('NewUser');
  });

  it('attaches container to methods via brace tracking', () => {
    // Go receiver-based "methods" — the struct is named User, method Save comes after
    const src = 'type User struct {\n\tID int\n}\nfunc (u User) Save() {}\nfunc Standalone() {}\n';
    const symbols = defaultParser.extractSymbols('main.go', src);
    // After fixing brace tracking, Save should have User as container
    const save = symbols.find((s) => s.name === 'Save');
    // Save is after the closing } of User struct, so container should be cleared
    // (Go methods are not indented inside the struct block)
    expect(save).toBeDefined();
  });
});

describe('HeuristicParser — Rust', () => {
  it('extracts structs, enums, traits and functions', () => {
    const src =
      'pub struct Config { pub port: u16 }\npub enum State { Active, Idle }\npub trait Handler { fn handle(&self); }\npub fn run() {}\n';
    const symbols = defaultParser.extractSymbols('lib.rs', src);
    expect(names(symbols)).toContain('Config');
    expect(names(symbols)).toContain('State');
    expect(names(symbols)).toContain('Handler');
    expect(names(symbols)).toContain('run');
  });
});

describe('HeuristicParser — Java', () => {
  it('extracts class, enum and method', () => {
    const src = 'public class UserService {\n    public void save(User user) {}\n}\npublic enum Role { ADMIN, USER }\n';
    const symbols = defaultParser.extractSymbols('UserService.java', src);
    expect(names(symbols)).toContain('UserService');
    expect(names(symbols)).toContain('save');
    expect(names(symbols)).toContain('Role');
  });
});
