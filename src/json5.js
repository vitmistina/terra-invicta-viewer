/**
 * A small, dependency-free JSON5 parser for Terra Invicta saves.
 *
 * Supported JSON5 features:
 * - line and block comments
 * - single and double quoted strings
 * - unquoted identifier keys
 * - trailing commas
 * - hexadecimal and leading-dot numbers
 * - Infinity and NaN
 *
 * The parser never evaluates source text as JavaScript.
 */
export function parseJson5(text) {
  return new Json5Parser(text).parse();
}

class Json5Parser {
  constructor(text) {
    this.text = text;
    this.position = 0;
  }

  parse() {
    this.skipTrivia();
    const value = this.parseValue();
    this.skipTrivia();
    if (!this.isEnd()) {
      this.fail(`Unexpected token ${JSON.stringify(this.peek())}`);
    }
    return value;
  }

  parseValue() {
    this.skipTrivia();
    const char = this.peek();

    if (char === '{') return this.parseObject();
    if (char === '[') return this.parseArray();
    if (char === '"' || char === "'") return this.parseString();

    if (char === '+' || char === '-') {
      const sign = char === '-' ? -1 : 1;
      const next = this.peek(1);
      if (isIdentifierStart(next)) {
        this.position += 1;
        const word = this.parseIdentifier();
        if (word === 'Infinity') return sign * Infinity;
        if (word === 'NaN') return NaN;
        this.fail(`Unexpected signed identifier ${word}`);
      }
      return this.parseNumber();
    }

    if (char === '.' || isDigit(char)) return this.parseNumber();

    if (isIdentifierStart(char)) {
      const identifier = this.parseIdentifier();
      switch (identifier) {
        case 'true': return true;
        case 'false': return false;
        case 'null': return null;
        case 'Infinity': return Infinity;
        case 'NaN': return NaN;
        default: this.fail(`Unexpected identifier ${identifier}`);
      }
    }

    this.fail(`Expected a value, found ${JSON.stringify(char)}`);
  }

  parseObject() {
    const result = {};
    this.expect('{');
    this.skipTrivia();

    if (this.consume('}')) return result;

    while (true) {
      this.skipTrivia();
      const key = this.peek() === '"' || this.peek() === "'"
        ? this.parseString()
        : this.parseIdentifierKey();

      this.skipTrivia();
      this.expect(':');
      result[key] = this.parseValue();
      this.skipTrivia();

      if (this.consume('}')) return result;
      this.expect(',');
      this.skipTrivia();
      if (this.consume('}')) return result;
    }
  }

  parseArray() {
    const result = [];
    this.expect('[');
    this.skipTrivia();

    if (this.consume(']')) return result;

    while (true) {
      result.push(this.parseValue());
      this.skipTrivia();
      if (this.consume(']')) return result;
      this.expect(',');
      this.skipTrivia();
      if (this.consume(']')) return result;
    }
  }

  parseString() {
    const quote = this.peek();
    this.position += 1;
    let result = '';

    while (!this.isEnd()) {
      const char = this.peek();
      this.position += 1;

      if (char === quote) return result;
      if (char === '\n' || char === '\r') this.fail('Unescaped newline in string');
      if (char !== '\\') {
        result += char;
        continue;
      }

      if (this.isEnd()) this.fail('Unterminated escape sequence');
      const escaped = this.peek();
      this.position += 1;

      switch (escaped) {
        case 'b': result += '\b'; break;
        case 'f': result += '\f'; break;
        case 'n': result += '\n'; break;
        case 'r': result += '\r'; break;
        case 't': result += '\t'; break;
        case 'v': result += '\v'; break;
        case '0':
          if (isDigit(this.peek())) this.fail('Octal escapes are not supported');
          result += '\0';
          break;
        case 'x': result += String.fromCodePoint(this.parseHexDigits(2)); break;
        case 'u': result += String.fromCodePoint(this.parseHexDigits(4)); break;
        case '\n': break;
        case '\r':
          if (this.peek() === '\n') this.position += 1;
          break;
        default: result += escaped;
      }
    }

    this.fail('Unterminated string');
  }

  parseHexDigits(count) {
    const source = this.text.slice(this.position, this.position + count);
    if (source.length !== count || !new RegExp(`^[0-9a-fA-F]{${count}}$`).test(source)) {
      this.fail(`Expected ${count} hexadecimal digits`);
    }
    this.position += count;
    return Number.parseInt(source, 16);
  }

  parseNumber() {
    const remaining = this.text.slice(this.position);
    const match = remaining.match(/^[+-]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/);
    if (!match) this.fail('Invalid number');

    this.position += match[0].length;
    const token = match[0];
    const signless = token.replace(/^[+-]/, '');
    const sign = token.startsWith('-') ? -1 : 1;
    const value = /^0[xX]/.test(signless)
      ? sign * Number.parseInt(signless.slice(2), 16)
      : Number(token);

    if (Number.isNaN(value)) this.fail(`Invalid number ${token}`);
    return value;
  }

  parseIdentifier() {
    if (!isIdentifierStart(this.peek())) this.fail('Expected identifier');
    const start = this.position;
    this.position += 1;
    while (isIdentifierPart(this.peek())) this.position += 1;
    return this.text.slice(start, this.position);
  }

  parseIdentifierKey() {
    if (isDigit(this.peek())) {
      const start = this.position;
      while (isDigit(this.peek())) this.position += 1;
      return this.text.slice(start, this.position);
    }
    return this.parseIdentifier();
  }

  skipTrivia() {
    while (!this.isEnd()) {
      const char = this.peek();
      if (/\s/.test(char)) {
        this.position += 1;
        continue;
      }

      if (char === '/' && this.peek(1) === '/') {
        this.position += 2;
        while (!this.isEnd() && this.peek() !== '\n' && this.peek() !== '\r') this.position += 1;
        continue;
      }

      if (char === '/' && this.peek(1) === '*') {
        this.position += 2;
        while (!this.isEnd() && !(this.peek() === '*' && this.peek(1) === '/')) this.position += 1;
        if (this.isEnd()) this.fail('Unterminated block comment');
        this.position += 2;
        continue;
      }

      return;
    }
  }

  expect(char) {
    if (!this.consume(char)) this.fail(`Expected ${JSON.stringify(char)}`);
  }

  consume(char) {
    if (this.peek() !== char) return false;
    this.position += 1;
    return true;
  }

  peek(offset = 0) {
    return this.text[this.position + offset] ?? '';
  }

  isEnd() {
    return this.position >= this.text.length;
  }

  fail(message) {
    const before = this.text.slice(0, this.position);
    const line = before.split(/\r\n|\r|\n/).length;
    const lastBreak = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
    const column = this.position - lastBreak;
    throw new SyntaxError(`${message} at line ${line}, column ${column}`);
  }
}

function isDigit(char) {
  return char >= '0' && char <= '9';
}

function isIdentifierStart(char) {
  return /[A-Za-z_$]/.test(char || '');
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_$]/.test(char || '');
}
