# cc_compiler.py
# Direct Python port of the CC -> CCASM compiler (more complete)
# - emits CC_MAGIC header, version, flags and string table
# - supports directives: ;use strict, ;use optimization N, ;use native
# - tokenizes, parses declarations, print, tick, wait, basic expressions, functions, loops
# - generates a WASM-like bytecode with many opcodes and simple optimizations
# - provides disassemble functionality and a CLI with options

import argparse
import sys
import re
from typing import List

CC_MAGIC = 0x43434153  # "CCAS"
CC_VERSION = 0x01

# Opcode map matching JS compiler
OP = {
    # Memory operations
    'LOAD': 0x00,
    'STORE': 0x01,
    'LOAD_IMM': 0x02,
    'LOAD_LOCAL': 0x03,
    'STORE_LOCAL': 0x04,
    'LOAD_STR': 0x05,

    # Fast-path immediates (match JS compiler/VM)
    'LOAD_IMM_0': 0x06,
    'LOAD_IMM_1': 0x07,
    'LOAD_IMM_M1': 0x08,
    'INC_LOCAL': 0x09,
    'DEC_LOCAL': 0x0A,

    # Combined arithmetic with immediates
    'ADD_IMM': 0x0B,
    'SUB_IMM': 0x0C,
    'MUL_IMM': 0x0D,
    'CMP_ZERO': 0x0E,
    'STORE_PUSH': 0x0F,

    # Arithmetic
    'ADD': 0x10,
    'SUB': 0x11,
    'MUL': 0x12,
    'DIV': 0x13,
    'MOD': 0x14,
    'INC': 0x15,
    'DEC': 0x16,
    'NEG': 0x17,

    # Comparison
    'EQ': 0x18,
    'NE': 0x19,
    'LT': 0x1A,
    'GT': 0x1B,
    'LE': 0x1C,
    'GE': 0x1D,

    # Bitwise
    'AND': 0x20,
    'OR': 0x21,
    'XOR': 0x22,
    'SHL': 0x23,
    'SHR': 0x24,
    'NOT': 0x25,

    # 8/16-bit console-friendly memory ops
    'LOAD8': 0x26,
    'STORE8': 0x27,
    'LOAD16': 0x28,
    'STORE16': 0x29,

    # Control flow
    'JMP': 0x30,
    'JZ': 0x31,
    'JNZ': 0x32,
    'CALL': 0x33,
    'RET': 0x34,
    'LOOP': 0x35,
    'ENDLOOP': 0x36,
    'BREAK': 0x37,
    'CONTINUE': 0x38,

    # Stack
    'PUSH': 0x40,
    'POP': 0x41,
    'DUP': 0x42,
    'SWAP': 0x43,

    # Cycle operations
    'TICK': 0x50,
    'WAIT': 0x51,

    # I/O
    'PRINT': 0x60,
    'INPUT': 0x61,

    # Special
    'NOP': 0xF0,
    'HALT': 0xFF,
}

# Helpers for emitting bytes
def emit32(buf: bytearray, value: int):
    buf.extend([
        value & 0xFF,
        (value >> 8) & 0xFF,
        (value >> 16) & 0xFF,
        (value >> 24) & 0xFF
    ])

def emit_byte(buf: bytearray, b: int):
    buf.append(b & 0xFF)

def header_bytes(string_table: List[str], functions: dict, use_strict=False, use_native=False, opt_level=2):
    """
    Build CCASM header:
    - 4 bytes magic
    - 1 byte version
    - 1 byte flags
    - 1 byte string count + strings
    - 1 byte export count + (nameIdx, addr) pairs
    NOTE: string_table must already include any exported function names.
    """
    buf = bytearray()
    emit32(buf, CC_MAGIC)
    emit_byte(buf, CC_VERSION)
    flags = (0x01 if use_strict else 0) | (0x02 if use_native else 0) | ((opt_level & 0x03) << 2)
    emit_byte(buf, flags)
    
    # string table (do not mutate string_table here to keep count consistent)
    emit_byte(buf, len(string_table))
    for s in string_table:
        encoded = s.encode('utf-8')
        emit_byte(buf, len(encoded))
        buf.extend(encoded)
        
    # function export table (for module support)
    emit_byte(buf, len(functions))
    for name, addr in functions.items():
        try:
            name_idx = string_table.index(name)
        except ValueError:
            # Fallback if compiler forgot to add name; use 0xFFFFFFFF
            name_idx = 0xFFFFFFFF
        emit32(buf, name_idx)
        emit32(buf, addr)
        
    return buf

# Tokenizer (expanded)
TOKEN_RE = re.compile(r'\s*(;use [^\n]*|=>|==|!=|<=|>=|<<|>>|\+\+|--|[{}()\[\];,+\-*/%&|^<>!=]|\d+|[a-zA-Z_]\w*|"[^"]*"|#[^\n]*)\s*')

def tokenize(source: str):
    tokens = []
    for m in TOKEN_RE.finditer(source):
        tok = m.group(1)
        if not tok:
            continue
        if tok.startswith('#'):
            continue
        if tok.startswith(';use'):
            tokens.append(('DIRECTIVE', tok))
            continue
        if tok.startswith('"') and tok.endswith('"'):
            tokens.append(('STRING', tok[1:-1]))
        elif tok.isdigit():
            tokens.append(('NUMBER', int(tok)))
        elif re.match(r'[a-zA-Z_]\w*', tok):
            tokens.append(('IDENT', tok))
        else:
            tokens.append(('CHAR', tok))
    return tokens

# Parser (simple but handles multiple constructs)
class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.i = 0

    def peek(self):
        return self.tokens[self.i] if self.i < len(self.tokens) else (None, None)

    def advance(self):
        t = self.tokens[self.i]
        self.i += 1
        return t

    def parse(self):
        body = []
        while self.i < len(self.tokens):
            stmt = self.parse_statement()
            if stmt:
                body.append(stmt)
        return {'type': 'program', 'body': body}

    def parse_statement(self):
        t, v = self.peek()
        if t is None:
            return None

        # directives handled earlier by compiler
        if t == 'IDENT' and v in ('let', 'const'):
            self.advance()
            _, name = self.advance()
            # optional '='
            if self.peek()[1] == '=':
                self.advance()
                expr = self.parse_expression()
                # optional semicolon
                if self.peek()[1] == ';':
                    self.advance()
                return {'type': 'declaration', 'name': name, 'value': expr, 'const': v == 'const'}
            else:
                # simple declaration without init
                if self.peek()[1] == ';':
                    self.advance()
                return {'type': 'declaration', 'name': name, 'value': None, 'const': v == 'const'}

        if t == 'IDENT' and v == 'print':
            self.advance()
            expr = self.parse_expression()
            if self.peek()[1] == ';':
                self.advance()
            return {'type': 'print', 'value': expr}

        if t == 'IDENT' and v == 'tick':
            self.advance()
            if self.peek()[1] == ';':
                self.advance()
            return {'type': 'tick'}

        if t == 'IDENT' and v == 'wait':
            self.advance()
            cycles = self.parse_expression()
            if self.peek()[1] == ';':
                self.advance()
            return {'type': 'wait', 'cycles': cycles}

        if t == 'IDENT' and v == 'fn':
            self.advance()
            _, name = self.advance()
            # optional params in parentheses are not strictly required for this port
            params = []
            if self.peek()[1] == '(':
                self.advance()
                while self.peek()[1] != ')':
                    _, p = self.advance()
                    params.append(p)
                    if self.peek()[1] == ',':
                        self.advance()
                self.advance()  # skip ')'
            # block
            if self.peek()[1] == '{':
                self.advance()
                body = []
                while self.peek()[1] != '}':
                    body.append(self.parse_statement())
                self.advance()
                return {'type': 'function', 'name': name, 'params': params, 'body': [b for b in body if b]}
            else:
                return {'type': 'function', 'name': name, 'params': params, 'body': []}

        # loop N { ... }
        if t == 'IDENT' and v == 'loop':
            self.advance()
            count = self.parse_expression()
            if self.peek()[1] == '{':
                self.advance()
                body = []
                while self.peek()[1] != '}':
                    body.append(self.parse_statement())
                self.advance()
                return {'type': 'loop', 'count': count, 'body': [b for b in body if b]}
            else:
                return {'type': 'loop', 'count': count, 'body': []}

        # if / while / assignment / expression fallback
        if t == 'IDENT' and v == 'if':
            self.advance()
            cond = self.parse_expression()
            if self.peek()[1] == '{':
                self.advance()
                cons = []
                while self.peek()[1] != '}':
                    cons.append(self.parse_statement())
                self.advance()
            else:
                cons = []
            alt = None
            if self.peek()[1] == 'else':
                self.advance()
                if self.peek()[1] == '{':
                    self.advance()
                    alt = []
                    while self.peek()[1] != '}':
                        alt.append(self.parse_statement())
                    self.advance()
            return {'type': 'if', 'condition': cond, 'consequent': cons, 'alternate': alt}

        # basic assignment: IDENT = expr ;
        if t == 'IDENT':
            # lookahead for assignment
            if len(self.tokens) > self.i + 1 and self.tokens[self.i + 1][1] == '=':
                _, name = self.advance()
                self.advance()  # =
                val = self.parse_expression()
                if self.peek()[1] == ';':
                    self.advance()
                return {'type': 'assignment', 'target': {'type': 'variable', 'name': name}, 'value': val}

        # else consume token to avoid infinite loop
        self.advance()
        return None

    def parse_expression(self):
        # For portability, support literal numbers, strings, and variable references only (enough for compiler demo)
        t, v = self.peek()
        if t == 'NUMBER':
            self.advance()
            return {'type': 'literal', 'value': v}
        if t == 'STRING':
            self.advance()
            return {'type': 'string', 'value': v}
        if t == 'IDENT':
            self.advance()
            return {'type': 'variable', 'name': v}
        # fallback - consume one token and return None-literal
        self.advance()
        return {'type': 'literal', 'value': 0}

# Code generator
class CCCompiler:
    def __init__(self):
        self.bytecode = []
        self.string_table = []
        self.local_vars = {}
        self.functions = {}
        self.optimization_level = 2
        self.use_strict = False
        self.use_native = False

    def _parse_directives(self, source: str):
        for line in source.splitlines():
            t = line.strip()
            if t == ';use strict':
                self.use_strict = True
            elif t.startswith(';use optimization'):
                parts = t.split()
                try:
                    lvl = int(parts[-1])
                    self.optimization_level = max(0, min(2, lvl))
                except Exception:
                    pass
            elif t == ';use native':
                self.use_native = True

    def compile(self, source: str) -> bytes:
        self.bytecode = []
        self.string_table = []
        self.local_vars = {}
        self.functions = {}

        self._parse_directives(source)
        tokens = tokenize(source)
        # remove directive tokens (they were parsed)
        tokens = [tk for tk in tokens if tk[0] != 'DIRECTIVE']
        parser = Parser(tokens)
        ast = parser.parse()

        # Generate body into separate buffer
        body = bytearray()
        self._generate_ast(ast, body)

        # Always emit HALT at end
        emit_byte(body, OP['HALT'])

        # Ensure exported function names are in string table
        for fname in self.functions.keys():
            if fname not in self.string_table:
                self.string_table.append(fname)

        # Build header + body (matches JS compiler format)
        hdr = header_bytes(
            self.string_table,
            self.functions,
            use_strict=self.use_strict,
            use_native=self.use_native,
            opt_level=self.optimization_level,
        )
        return bytes(hdr + body)

    def _add_string(self, s: str):
        if s in self.string_table:
            return self.string_table.index(s)
        self.string_table.append(s)
        return len(self.string_table) - 1

    def _get_local(self, name: str):
        if name not in self.local_vars:
            self.local_vars[name] = len(self.local_vars)
        return self.local_vars[name]

    def _emit(self, buf: bytearray, opcode_name: str, operand=None):
        emit_byte(buf, OP.get(opcode_name, OP['NOP']))
        if operand is not None:
            if isinstance(operand, int):
                emit32(buf, operand)
            else:
                # if operand is a label placeholder (int), assume int
                emit32(buf, int(operand))

    def _generate_ast(self, ast: dict, buf: bytearray):
        for node in ast.get('body', []):
            self._generate_node(node, buf)

    def _generate_node(self, node, buf: bytearray):
        if node is None:
            return
        t = node.get('type')
        if t == 'declaration':
            val = node.get('value')
            if val:
                self._generate_expr(val, buf)
                self._emit(buf, 'STORE_LOCAL', self._get_local(node['name']))
            else:
                # initialize zero
                self._emit(buf, 'LOAD_IMM', 0)
                self._emit(buf, 'STORE_LOCAL', self._get_local(node['name']))
        elif t == 'assignment':
            self._generate_expr(node['value'], buf)
            target = node['target']
            if target.get('type') == 'variable':
                self._emit(buf, 'STORE_LOCAL', self._get_local(target['name']))
        elif t == 'print':
            self._generate_expr(node['value'], buf)
            self._emit(buf, 'PRINT')
        elif t == 'tick':
            self._emit(buf, 'TICK')
        elif t == 'wait':
            self._generate_expr(node['cycles'], buf)
            self._emit(buf, 'WAIT')
        elif t == 'function':
            # store function address as current buffer length (note: simplistic single-pass)
            addr = len(buf)
            self.functions[node['name']] = addr
            for stmt in node.get('body', []):
                self._generate_node(stmt, buf)
            self._emit(buf, 'RET')
        elif t == 'loop':
            start = len(buf)
            # evaluate count
            self._generate_expr(node['count'], buf)
            self._emit(buf, 'LOOP')
            for stmt in node.get('body', []):
                self._generate_node(stmt, buf)
            self._emit(buf, 'ENDLOOP')
            # for this simple emitter, loop back via JMP to start
            self._emit(buf, 'JMP', start)
        elif t == 'if':
            self._generate_expr(node['condition'], buf)
            # placeholder JZ operand
            jz_pos = len(buf)
            self._emit(buf, 'JZ', 0)
            for s in node.get('consequent', []):
                self._generate_node(s, buf)
            if node.get('alternate'):
                # placeholder JMP to skip else
                jmp_pos = len(buf)
                self._emit(buf, 'JMP', 0)
                # fix JZ to current pos
                target = len(buf)
                # overwrite operand at jz_pos+1..4 (little endian)
                self._write_operand(buf, jz_pos + 1, target)
                for s in node.get('alternate', []):
                    self._generate_node(s, buf)
                # fix JMP to current pos
                self._write_operand(buf, jmp_pos + 1, len(buf))
            else:
                self._write_operand(buf, jz_pos + 1, len(buf))
        # other node types omitted for brevity

    def _write_operand(self, buf: bytearray, offset: int, value: int):
        # write 4 bytes little-endian at offset
        b = [
            value & 0xFF,
            (value >> 8) & 0xFF,
            (value >> 16) & 0xFF,
            (value >> 24) & 0xFF
        ]
        buf[offset:offset+4] = bytes(b)

    def _generate_expr(self, expr, buf: bytearray):
        if expr is None:
            self._emit(buf, 'LOAD_IMM', 0)
            return
        et = expr.get('type')
        if et == 'literal':
            self._emit(buf, 'LOAD_IMM', expr.get('value', 0))
        elif et == 'string':
            idx = self._add_string(expr.get('value', ''))
            self._emit(buf, 'LOAD_STR', idx)
        elif et == 'variable':
            self._emit(buf, 'LOAD_LOCAL', self._get_local(expr.get('name')))
        else:
            self._emit(buf, 'LOAD_IMM', 0)

    # Disassembler for produced bytecode
    def disassemble(self, data: bytes) -> str:
        lines = []
        pc = 0
        string_table = []
        if len(data) >= 6:
            magic = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)
            if magic == CC_MAGIC:
                lines.append(f'Header: CC_MAGIC (0x{magic:x})')
                lines.append(f'Version: {data[4]}')
                flags = data[5]
                lines.append(f'Flags: strict={bool(flags & 0x01)}, native={bool(flags & 0x02)}, opt={(flags >> 2) & 0x03}')
                pc = 6
                str_count = data[pc]; pc += 1
                lines.append(f'Strings: {str_count}')
                for i in range(str_count):
                    ln = data[pc]; pc += 1
                    s = bytes(data[pc:pc+ln]).decode('utf-8'); pc += ln
                    string_table.append(s)
                    lines.append(f'  [{i}]: "{s}"')
                
                # read function export table
                func_count = data[pc]; pc += 1
                lines.append(f'Exports: {func_count}')
                for i in range(func_count):
                    name_idx = data[pc] | (data[pc+1]<<8) | (data[pc+2]<<16) | (data[pc+3]<<24); pc += 4
                    addr = data[pc] | (data[pc+1]<<8) | (data[pc+2]<<16) | (data[pc+3]<<24); pc += 4
                    name = string_table[name_idx] if name_idx < len(string_table) else "???"
                    lines.append(f'  {name} -> 0x{addr:04x}')
                lines.append('---')
        while pc < len(data):
            opcode = data[pc]
            opname = next((k for k,v in OP.items() if v==opcode), 'UNKNOWN')
            line = f'{pc:04x}: {opname}'
            # opcodes with 4-byte operand
            has_operand = {
                OP['LOAD_IMM'],
                OP['STORE'],
                OP['LOAD'],
                OP['LOAD8'],
                OP['STORE8'],
                OP['LOAD16'],
                OP['STORE16'],
                OP['JMP'],
                OP['JZ'],
                OP['JNZ'],
                OP['LOAD_LOCAL'],
                OP['STORE_LOCAL'],
                OP['CALL'],
                OP['LOAD_STR'],
            }
            if opcode in has_operand:
                if pc + 4 >= len(data):
                    line += ' <truncated operand>'
                    pc += 1
                else:
                    operand = data[pc+1] | (data[pc+2]<<8) | (data[pc+3]<<16) | (data[pc+4]<<24)
                    if opcode == OP['LOAD_STR'] and operand < len(string_table):
                        line += f' {operand} "{string_table[operand]}"'
                    else:
                        line += f' {operand}'
                    pc += 5
            else:
                pc += 1
            lines.append(line)
        return '\n'.join(lines)

# Convenience function for CLI
def compile_file(path: str, out_path: str=None, opt=2, strict=False, native=False, disasm=False):
    with open(path, 'r', encoding='utf-8') as f:
        src = f.read()
    compiler = CCCompiler()
    compiler.optimization_level = opt
    compiler.use_native = native
    compiler.use_strict = strict
    bc = compiler.compile(src)
    if out_path:
        with open(out_path, 'wb') as fo:
            fo.write(bc)
        print(f'Wrote {out_path} ({len(bc)} bytes)')
    else:
        # default out next to input
        out_default = path.rsplit('.',1)[0] + '.ccasm'
        with open(out_default, 'wb') as fo:
            fo.write(bc)
        print(f'Wrote {out_default} ({len(bc)} bytes)')

    if disasm:
        print('--- Disassembly ---')
        print(compiler.disassemble(bc))

# CLI
def main():
    parser = argparse.ArgumentParser(description='CC -> CCASM Python compiler (direct port)')
    parser.add_argument('source', help='Source .cc file')
    parser.add_argument('-o', '--out', help='Output .ccasm file')
    parser.add_argument('--opt', type=int, choices=[0,1,2], default=2, help='Optimization level (0-2)')
    parser.add_argument('--strict', action='store_true', help='Enable strict mode')
    parser.add_argument('--native', action='store_true', help='Enable native optimizations flag')
    parser.add_argument('--disasm', action='store_true', help='Print disassembly after compile')
    args = parser.parse_args()

    try:
        compile_file(args.source, out_path=args.out, opt=args.opt, strict=args.strict, native=args.native, disasm=args.disasm)
    except Exception as e:
        print(f'Compilation failed: {e}', file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()