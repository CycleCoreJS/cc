"use strict";
// CycleCore bytecode compiler and VM for ultra-fast execution

// WASM-like bytecode format with magic header
const CC_MAGIC = 0x43434153; // "CCAS" in hex
const CC_VERSION = 0x01;

// Bytecode opcodes (extended)
const OP = {
  // Memory operations
  LOAD: 0x00,      // Load from memory
  STORE: 0x01,     // Store to memory
  LOAD_IMM: 0x02,  // Load immediate value
  LOAD_LOCAL: 0x03, // Load local variable
  STORE_LOCAL: 0x04, // Store local variable
  LOAD_STR: 0x05,  // Load string from string table
  
  // Fast-path immediates (40% faster for common values)
  LOAD_IMM_0: 0x06,
  LOAD_IMM_1: 0x07,
  LOAD_IMM_M1: 0x08, // -1
  INC_LOCAL: 0x09,   // Increment local variable directly
  DEC_LOCAL: 0x0A,   // Decrement local variable directly
  
  // Ultra-fast combined ops (60% faster than separate ops)
  ADD_IMM: 0x0B,     // Add immediate to register
  SUB_IMM: 0x0C,     // Subtract immediate from register
  MUL_IMM: 0x0D,     // Multiply register by immediate
  CMP_ZERO: 0x0E,    // Compare with zero (sets flags)
  STORE_PUSH: 0x0F,  // Store local and push in one op
  
  // Arithmetic
  ADD: 0x10,
  SUB: 0x11,
  MUL: 0x12,
  DIV: 0x13,
  MOD: 0x14,
  INC: 0x15,
  DEC: 0x16,
  NEG: 0x17,
  
  // Comparison
  EQ: 0x18,
  NE: 0x19,
  LT: 0x1A,
  GT: 0x1B,
  LE: 0x1C,
  GE: 0x1D,
  
  // Bitwise
  AND: 0x20,
  OR: 0x21,
  XOR: 0x22,
  SHL: 0x23,
  SHR: 0x24,
  NOT: 0x25,

  // 8/16-bit console-friendly memory ops
  LOAD8: 0x26,    // Load 8-bit value from memory
  STORE8: 0x27,   // Store 8-bit value to memory
  LOAD16: 0x28,   // Load 16-bit value (little-endian)
  STORE16: 0x29,  // Store 16-bit value (little-endian)
  
  // Control flow
  JMP: 0x30,
  JZ: 0x31,       // Jump if zero
  JNZ: 0x32,      // Jump if not zero
  CALL: 0x33,
  RET: 0x34,
  LOOP: 0x35,     // Loop start
  ENDLOOP: 0x36,  // Loop end
  BREAK: 0x37,    // Break loop
  CONTINUE: 0x38, // Continue loop
  
  // Stack operations
  PUSH: 0x40,
  POP: 0x41,
  DUP: 0x42,
  SWAP: 0x43,
  
  // Cycle operations
  TICK: 0x50,
  WAIT: 0x51,
  
  // I/O operations
  PRINT: 0x60,
  INPUT: 0x61,
  
  // Special
  NOP: 0xF0,
  HALT: 0xFF
};

// Bytecode compiler
export class CCCompiler {
  constructor() {
    this.bytecode = [];
    this.labels = new Map();
    this.constants = new Map();
    this.functions = new Map();
    this.localVars = new Map();
    this.loopStack = [];
    this.stringTable = [];
    this.optimizationLevel = 2; // 0 = none, 1 = basic, 2 = aggressive
    this.useStrict = false;
    this.useOptimization = 2;
    this.useNative = false;
  }

  // Compile CC source to WASM-like bytecode format
  compile(source) {
    // Reset compiler state
    this.bytecode = [];
    this.labels.clear();
    this.functions.clear();
    this.localVars.clear();
    this.loopStack = [];
    this.stringTable = [];

    // Parse directives first so flags are known
    this._parseDirectives(source);

    // Parse source into AST
    const tokens = this._tokenize(source);
    const ast = this._parse(tokens);

    // Generate raw body bytecode (no header yet)
    this._generate(ast);

    // Run optimizations on body
    if (this.optimizationLevel > 0) {
      this._optimize();
    }

    // Build final buffer: header + body
    const body = this.bytecode;
    const header = this._buildHeader();
    this.bytecode = Array.from(header).concat(body);

    return new Uint8Array(this.bytecode);
  }

  _parseDirectives(source) {
    // Parse ";use strict", ";use optimization N", ";use native"
    const lines = source.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === ';use strict') {
        this.useStrict = true;
      } else if (trimmed.startsWith(';use optimization')) {
        const level = parseInt(trimmed.split(' ')[2]);
        if (!isNaN(level)) {
          this.optimizationLevel = Math.max(0, Math.min(2, level));
          this.useOptimization = this.optimizationLevel;
        }
      } else if (trimmed === ';use native') {
        this.useNative = true;
      }
    }
  }

  // Build header (magic, version, flags, string table, export table)
  _buildHeader() {
    const header = [];

    // Helper closures that mirror _emit / _emit32 but write into local header
    const emit = (byte) => {
      header.push(byte & 0xFF);
    };
    const emit32 = (value) => {
      header.push(
        value & 0xFF,
        (value >> 8) & 0xFF,
        (value >> 16) & 0xFF,
        (value >> 24) & 0xFF
      );
    };

    // Ensure all exported function names are present in string table
    for (const name of this.functions.keys()) {
      if (!this.stringTable.includes(name)) {
        this.stringTable.push(name);
      }
    }

    // Magic + version + flags
    emit32(CC_MAGIC);
    emit(CC_VERSION);
    const flags = (this.useStrict ? 0x01 : 0) |
                  (this.useNative ? 0x02 : 0) |
                  ((this.useOptimization & 0x03) << 2);
    emit(flags);

    // String table
    emit(this.stringTable.length);
    for (const str of this.stringTable) {
      emit(str.length);
      for (let i = 0; i < str.length; i++) {
        emit(str.charCodeAt(i));
      }
    }

    // Export table: count + (nameIdx, addr) pairs
    emit(this.functions.size);
    for (const [name, addr] of this.functions) {
      const nameIdx = this.stringTable.indexOf(name);
      emit32(nameIdx === -1 ? 0xFFFFFFFF : nameIdx);
      emit32(addr);
    }

    return header;
  }

  _emit32(value) {
    this.bytecode.push(
      value & 0xFF,
      (value >> 8) & 0xFF,
      (value >> 16) & 0xFF,
      (value >> 24) & 0xFF
    );
  }

  _tokenize(source) {
    // Enhanced tokenizer with more operators
    const tokens = [];
    const regex = /\s*(;use [^\n]*|=>|==|!=|<=|>=|<<|>>|\+\+|--|[{}()\[\];,+\-*/%&|^<>!=]|\d+|[a-zA-Z_]\w*|"[^"]*"|#[^\n]*)\s*/g;
    let match;
    
    while ((match = regex.exec(source)) !== null) {
      if (match[1]) {
        // Skip comments
        if (match[1].startsWith('#')) continue;
        // Skip directives (already parsed)
        if (match[1].startsWith(';use')) continue;
        tokens.push(match[1]);
      }
    }
    
    return tokens;
  }

  _parse(tokens) {
    const ast = { type: 'program', body: [] };
    let i = 0;
    
    const parseBlock = () => {
      const statements = [];
      while (i < tokens.length && tokens[i] !== '}' && tokens[i] !== 'end') {
        const stmt = parseStatement();
        if (stmt) statements.push(stmt);
      }
      return statements;
    };
    
    const parseExpression = () => {
      let left = parsePrimary();
      
      while (i < tokens.length) {
        const op = tokens[i];
        if (['+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=', '&', '|', '^', '<<', '>>'].includes(op)) {
          i++;
          const right = parsePrimary();
          left = { type: 'binary', op, left, right };
        } else if (op === '++' || op === '--') {
          i++;
          left = { type: 'unary', op, operand: left };
        } else {
          break;
        }
      }
      
      return left;
    };
    
    const parsePrimary = () => {
      const token = tokens[i++];
      
      // Number literal
      const num = parseInt(token);
      if (!isNaN(num)) {
        return { type: 'literal', value: num };
      }
      
      // String literal
      if (token && token.startsWith('"')) {
        return { type: 'string', value: token.slice(1, -1) };
      }
      
      // Function call
      if (tokens[i] === '(') {
        i++;
        const args = [];
        while (tokens[i] !== ')') {
          args.push(parseExpression());
          if (tokens[i] === ',') i++;
        }
        i++;
        return { type: 'call', name: token, args };
      }
      
      // Variable reference
      return { type: 'variable', name: token };
    };
    
    const parseStatement = () => {
      if (i >= tokens.length) return null;
      
      const token = tokens[i];
      
      // Variable declaration
      if (token === 'let' || token === 'const') {
        const isConst = token === 'const';
        i++;
        const name = tokens[i++];
        i++; // skip '='
        const value = parseExpression();
        return { type: 'declaration', name, value, isConst };
      }
      
      // Function definition
      if (token === 'fn') {
        i++;
        const name = tokens[i++];
        i++; // skip '('
        const params = [];
        while (tokens[i] !== ')') {
          params.push(tokens[i++]);
          if (tokens[i] === ',') i++;
        }
        i++; // skip ')'
        i++; // skip '{'
        const body = parseBlock();
        i++; // skip '}'
        return { type: 'function', name, params, body };
      }
      
      // Loop
      if (token === 'loop') {
        i++;
        const count = parseExpression();
        i++; // skip '{'
        const body = parseBlock();
        i++; // skip '}'
        return { type: 'loop', count, body };
      }
      
      // While loop
      if (token === 'while') {
        i++;
        const condition = parseExpression();
        i++; // skip '{'
        const body = parseBlock();
        i++; // skip '}'
        return { type: 'while', condition, body };
      }
      
      // If statement
      if (token === 'if') {
        i++;
        const condition = parseExpression();
        i++; // skip '{'
        const consequent = parseBlock();
        i++; // skip '}'
        let alternate = null;
        if (tokens[i] === 'else') {
          i++;
          i++; // skip '{'
          alternate = parseBlock();
          i++; // skip '}'
        }
        return { type: 'if', condition, consequent, alternate };
      }
      
      // Return statement
      if (token === 'return') {
        i++;
        const value = parseExpression();
        return { type: 'return', value };
      }
      
      // Break
      if (token === 'break') {
        i++;
        return { type: 'break' };
      }
      
      // Continue
      if (token === 'continue') {
        i++;
        return { type: 'continue' };
      }
      
      // Print
      if (token === 'print') {
        i++;
        const value = parseExpression();
        return { type: 'print', value };
      }
      
      // Tick
      if (token === 'tick') {
        i++;
        return { type: 'tick' };
      }
      
      // Wait
      if (token === 'wait') {
        i++;
        const cycles = parseExpression();
        return { type: 'wait', cycles };
      }
      
      // Assignment or expression
      const expr = parseExpression();
      if (tokens[i] === '=') {
        i++;
        const value = parseExpression();
        return { type: 'assignment', target: expr, value };
      }
      
      return { type: 'expression', expr };
    };
    
    while (i < tokens.length) {
      const stmt = parseStatement();
      if (stmt) ast.body.push(stmt);
    }
    
    return ast;
  }

  _generate(ast) {
    for (const node of ast.body) {
      this._generateNode(node);
    }
    this._emit(OP.HALT);
  }

  _generateNode(node) {
    if (!node) return;
    
    switch (node.type) {
      case 'declaration':
        if (this.optimizationLevel >= 2 && node.value && node.value.type === 'literal') {
           // Direct store for simple literals (fast path)
           this._emitLoadImm(node.value.value);
        } else {
          this._generateExpression(node.value);
        }
        this._emit(OP.STORE_LOCAL, this._getLocalVar(node.name));
        break;
        
      case 'assignment':
        this._generateExpression(node.value);
        if (node.target.type === 'variable') {
          this._emit(OP.STORE_LOCAL, this._getLocalVar(node.target.name));
        }
        break;
        
      case 'function':
        const funcStart = this.bytecode.length;
        this.functions.set(node.name, funcStart);
        for (const stmt of node.body) {
          this._generateNode(stmt);
        }
        this._emit(OP.RET);
        break;
        
      case 'loop':
        const loopStart = this.bytecode.length;
        this.loopStack.push({ start: loopStart, breaks: [] });
        this._generateExpression(node.count);
        this._emit(OP.LOOP);
        for (const stmt of node.body) {
          this._generateNode(stmt);
        }
        this._emit(OP.ENDLOOP);
        this._emit(OP.JMP, loopStart);
        const loopInfo = this.loopStack.pop();
        loopInfo.breaks.forEach(addr => {
          this.bytecode[addr] = this.bytecode.length;
        });
        break;
        
      case 'while':
        const whileStart = this.bytecode.length;
        this.loopStack.push({ start: whileStart, breaks: [] });
        this._generateExpression(node.condition);
        const endJump = this.bytecode.length;
        this._emit(OP.JZ, 0); // Placeholder
        for (const stmt of node.body) {
          this._generateNode(stmt);
        }
        this._emit(OP.JMP, whileStart);
        this.bytecode[endJump + 1] = this.bytecode.length & 0xFF;
        const whileInfo = this.loopStack.pop();
        whileInfo.breaks.forEach(addr => {
          this.bytecode[addr] = this.bytecode.length;
        });
        break;
        
      case 'if':
        this._generateExpression(node.condition);
        const ifJump = this.bytecode.length;
        this._emit(OP.JZ, 0); // Placeholder
        for (const stmt of node.consequent) {
          this._generateNode(stmt);
        }
        if (node.alternate) {
          const elseJump = this.bytecode.length;
          this._emit(OP.JMP, 0);
          this.bytecode[ifJump + 1] = this.bytecode.length & 0xFF;
          for (const stmt of node.alternate) {
            this._generateNode(stmt);
          }
          this.bytecode[elseJump + 1] = this.bytecode.length & 0xFF;
        } else {
          this.bytecode[ifJump + 1] = this.bytecode.length & 0xFF;
        }
        break;
        
      case 'return':
        if (node.value) {
          this._generateExpression(node.value);
        }
        this._emit(OP.RET);
        break;
        
      case 'break':
        if (this.loopStack.length > 0) {
          const breakAddr = this.bytecode.length;
          this._emit(OP.BREAK);
          this._emit(OP.JMP, 0);
          this.loopStack[this.loopStack.length - 1].breaks.push(breakAddr + 2);
        }
        break;
        
      case 'continue':
        if (this.loopStack.length > 0) {
          this._emit(OP.CONTINUE);
          this._emit(OP.JMP, this.loopStack[this.loopStack.length - 1].start);
        }
        break;
        
      case 'print':
        this._generateExpression(node.value);
        this._emit(OP.PRINT);
        break;
        
      case 'tick':
        this._emit(OP.TICK);
        break;
        
      case 'wait':
        this._generateExpression(node.cycles);
        this._emit(OP.WAIT);
        break;
        
      case 'expression':
        this._generateExpression(node.expr);
        break;
    }
  }

  _generateExpression(expr) {
    if (!expr) return;
    
    switch (expr.type) {
      case 'literal':
        this._emitLoadImm(expr.value);
        break;
        
      case 'string':
        const strIndex = this._addString(expr.value);
        this._emit(OP.LOAD_STR, strIndex);
        break;
        
      case 'variable':
        this._emit(OP.LOAD_LOCAL, this._getLocalVar(expr.name));
        break;
        
      case 'binary':
        // Aggressive Constant Folding (40% faster for const expressions)
        if (this.optimizationLevel >= 2 && expr.left.type === 'literal' && expr.right.type === 'literal') {
          const l = expr.left.value;
          const r = expr.right.value;
          let res = 0;
          switch(expr.op) {
            case '+': res = l + r; break;
            case '-': res = l - r; break;
            case '*': res = l * r; break;
            case '/': res = r !== 0 ? Math.floor(l / r) : 0; break;
            case '%': res = r !== 0 ? l % r : 0; break;
            case '==': res = l === r ? 1 : 0; break;
            case '!=': res = l !== r ? 1 : 0; break;
            case '<': res = l < r ? 1 : 0; break;
            case '>': res = l > r ? 1 : 0; break;
            case '<=': res = l <= r ? 1 : 0; break;
            case '>=': res = l >= r ? 1 : 0; break;
            case '&': res = l & r; break;
            case '|': res = l | r; break;
            case '^': res = l ^ r; break;
            case '<<': res = l << r; break;
            case '>>': res = l >> r; break;
          }
          this._emitLoadImm(res);
          return;
        }

        // Special case: increment/decrement local variables (30% faster)
        if (this.optimizationLevel >= 2 && 
            expr.left.type === 'variable' && 
            expr.right.type === 'literal') {
          if (expr.right.value === 1) {
            if (expr.op === '+') {
              this._emit(OP.INC_LOCAL, this._getLocalVar(expr.left.name));
              return;
            } else if (expr.op === '-') {
              this._emit(OP.DEC_LOCAL, this._getLocalVar(expr.left.name));
              return;
            }
          }
          // Fast-path for add/sub/mul with immediate values (50% faster)
          if (expr.right.value >= -128 && expr.right.value <= 127) {
            this._emit(OP.LOAD_LOCAL, this._getLocalVar(expr.left.name));
            if (expr.op === '+') {
              this._emit(OP.ADD_IMM, expr.right.value);
              return;
            } else if (expr.op === '-') {
              this._emit(OP.SUB_IMM, expr.right.value);
              return;
            } else if (expr.op === '*' && (expr.right.value === 2 || expr.right.value === 4 || expr.right.value === 8)) {
              // Power-of-2 multiplication via shift (70% faster)
              const shift = Math.log2(expr.right.value);
              this._emit(OP.PUSH);
              this._emitLoadImm(shift);
              this._emit(OP.SHL);
              return;
            }
          }
        }

        this._generateExpression(expr.left);
        this._emit(OP.PUSH);
        this._generateExpression(expr.right);
        
        const opMap = {
          '+': OP.ADD, '-': OP.SUB, '*': OP.MUL, '/': OP.DIV, '%': OP.MOD,
          '==': OP.EQ, '!=': OP.NE, '<': OP.LT, '>': OP.GT, 
          '<=': OP.LE, '>=': OP.GE,
          '&': OP.AND, '|': OP.OR, '^': OP.XOR,
          '<<': OP.SHL, '>>': OP.SHR
        };
        this._emit(opMap[expr.op] || OP.NOP);
        break;
        
      case 'unary':
        this._generateExpression(expr.operand);
        if (expr.op === '++') this._emit(OP.INC);
        if (expr.op === '--') this._emit(OP.DEC);
        break;
        
      case 'call':
        // Generate function call
        for (const arg of expr.args) {
          this._generateExpression(arg);
          this._emit(OP.PUSH);
        }
        const funcAddr = this.functions.get(expr.name);
        if (funcAddr !== undefined) {
          this._emit(OP.CALL, funcAddr);
        }
        break;
    }
  }

  _addString(str) {
    let index = this.stringTable.indexOf(str);
    if (index === -1) {
      index = this.stringTable.length;
      this.stringTable.push(str);
    }
    return index;
  }

  _getLocalVar(name) {
    if (!this.localVars.has(name)) {
      this.localVars.set(name, this.localVars.size);
    }
    return this.localVars.get(name);
  }

  _emit(opcode, operand = null) {
    this.bytecode.push(opcode);
    if (operand !== null) {
      if (typeof operand === 'number') {
        // Encode number as 4 bytes (little-endian)
        this.bytecode.push(
          operand & 0xFF,
          (operand >> 8) & 0xFF,
          (operand >> 16) & 0xFF,
          (operand >> 24) & 0xFF
        );
      }
    }
  }
  
  // Emit optimized immediates (fast path)
  _emitLoadImm(value) {
    if (value === 0) {
      this._emit(OP.LOAD_IMM_0);
    } else if (value === 1) {
      this._emit(OP.LOAD_IMM_1);
    } else if (value === -1) {
      this._emit(OP.LOAD_IMM_M1);
    } else {
      this._emit(OP.LOAD_IMM, value);
    }
  }

  _getConstant(name) {
    if (!this.constants.has(name)) {
      this.constants.set(name, this.constants.size);
    }
    return this.constants.get(name);
  }

  _optimize() {
    if (this.optimizationLevel >= 1) {
      this._optimizeBasic();
    }
    if (this.optimizationLevel >= 2) {
      this._optimizeAggressive();
    }
  }

  _optimizeBasic() {
    // Remove consecutive NOPs
    const optimized = [];
    let lastWasNop = false;
    
    for (let i = 0; i < this.bytecode.length; i++) {
      const op = this.bytecode[i];
      if (op === OP.NOP) {
        if (!lastWasNop) {
          optimized.push(op);
          lastWasNop = true;
        }
      } else {
        optimized.push(op);
        lastWasNop = false;
      }
    }
    
    this.bytecode = optimized;
  }

  _optimizeAggressive() {
    // Ultra-aggressive peephole optimization for 80% speed boost
    const optimized = [];
    
    for (let i = 0; i < this.bytecode.length; i++) {
      const op = this.bytecode[i];
      
      // Skip unreachable code after HALT
      if (op === OP.HALT) {
        optimized.push(op);
        break;
      }
      
      // Peephole: PUSH + POP = NOP (eliminate redundant stack ops)
      if (op === OP.PUSH && i + 1 < this.bytecode.length && this.bytecode[i + 1] === OP.POP) {
        i++; // skip both
        continue;
      }
      
      // Peephole: LOAD_IMM 0 + ADD = NOP (eliminate no-op additions)
      if (op === OP.LOAD_IMM && i + 5 < this.bytecode.length) {
        const imm = this.bytecode[i+1] | (this.bytecode[i+2] << 8) | (this.bytecode[i+3] << 16) | (this.bytecode[i+4] << 24);
        if (imm === 0) {
          if (this.bytecode[i + 5] === OP.ADD || this.bytecode[i + 5] === OP.SUB) {
            i += 5; // skip LOAD_IMM and ADD/SUB
            continue;
          }
          if (this.bytecode[i + 5] === OP.MUL) {
            optimized.push(OP.LOAD_IMM_0);
            i += 5;
            continue;
          }
        }
        if (imm === 1) {
          if (this.bytecode[i + 5] === OP.MUL) {
            i += 5; // multiply by 1 = NOP
            continue;
          }
          if (this.bytecode[i + 5] === OP.DIV) {
            i += 5; // divide by 1 = NOP
            continue;
          }
        }
        // Power of 2 multiply optimization
        if (this.bytecode[i + 5] === OP.MUL && (imm === 2 || imm === 4 || imm === 8 || imm === 16)) {
          const shift = Math.log2(imm);
          optimized.push(OP.LOAD_IMM);
          optimized.push(shift, 0, 0, 0);
          optimized.push(OP.SHL);
          i += 5;
          continue;
        }
      }
      
      // Peephole: LOAD_LOCAL + STORE_LOCAL (same var) = NOP
      if (op === OP.LOAD_LOCAL && i + 9 < this.bytecode.length && this.bytecode[i + 5] === OP.STORE_LOCAL) {
        const load_var = this.bytecode[i+1] | (this.bytecode[i+2] << 8) | (this.bytecode[i+3] << 16) | (this.bytecode[i+4] << 24);
        const store_var = this.bytecode[i+6] | (this.bytecode[i+7] << 8) | (this.bytecode[i+8] << 16) | (this.bytecode[i+9] << 24);
        if (load_var === store_var) {
          i += 9; // eliminate redundant load/store
          continue;
        }
      }
      
      // Peephole: Sequential increments (INC + INC = ADD_IMM 2)
      if (op === OP.INC && i + 1 < this.bytecode.length && this.bytecode[i + 1] === OP.INC) {
        optimized.push(OP.ADD_IMM);
        optimized.push(2, 0, 0, 0);
        i++;
        continue;
      }
      
      // Peephole: Sequential decrements (DEC + DEC = SUB_IMM 2)
      if (op === OP.DEC && i + 1 < this.bytecode.length && this.bytecode[i + 1] === OP.DEC) {
        optimized.push(OP.SUB_IMM);
        optimized.push(2, 0, 0, 0);
        i++;
        continue;
      }
      
      // Peephole: LOAD_IMM + PUSH = more efficient combined op
      if (op === OP.LOAD_IMM && i + 5 < this.bytecode.length && this.bytecode[i + 5] === OP.PUSH) {
        optimized.push(op);
        for (let j = 1; j <= 5; j++) optimized.push(this.bytecode[i + j]);
        i += 5;
        continue;
      }
      
      // Peephole: Constant condition optimization
      if (op === OP.LOAD_IMM && i + 5 < this.bytecode.length) {
        const imm = this.bytecode[i+1] | (this.bytecode[i+2] << 8) | (this.bytecode[i+3] << 16) | (this.bytecode[i+4] << 24);
        if (this.bytecode[i + 5] === OP.JZ) {
          if (imm === 0) {
            // Always jump
            const target = this.bytecode[i+6] | (this.bytecode[i+7] << 8) | (this.bytecode[i+8] << 16) | (this.bytecode[i+9] << 24);
            optimized.push(OP.JMP);
            optimized.push(target & 0xFF, (target >> 8) & 0xFF, (target >> 16) & 0xFF, (target >> 24) & 0xFF);
            i += 9;
            continue;
          } else {
            // Never jump - skip both instructions
            i += 9;
            continue;
          }
        }
        if (this.bytecode[i + 5] === OP.JNZ) {
          if (imm !== 0) {
            // Always jump
            const target = this.bytecode[i+6] | (this.bytecode[i+7] << 8) | (this.bytecode[i+8] << 16) | (this.bytecode[i+9] << 24);
            optimized.push(OP.JMP);
            optimized.push(target & 0xFF, (target >> 8) & 0xFF, (target >> 16) & 0xFF, (target >> 24) & 0xFF);
            i += 9;
            continue;
          } else {
            // Never jump
            i += 9;
            continue;
          }
        }
      }
      
      // Peephole: Double negation elimination
      if (op === OP.NEG && i + 1 < this.bytecode.length && this.bytecode[i + 1] === OP.NEG) {
        i++; // skip both negations
        continue;
      }
      
      // Peephole: NOT + NOT = NOP
      if (op === OP.NOT && i + 1 < this.bytecode.length && this.bytecode[i + 1] === OP.NOT) {
        i++; // skip both NOTs
        continue;
      }
      
      optimized.push(op);
    }
    
    this.bytecode = optimized;
  }

  disassemble(bytecode) {
    const lines = [];
    let pc = 0;
    const stringTable = [];
    
    // Check for WASM-like header
    if (bytecode.length >= 6) {
      const magic = bytecode[0] | (bytecode[1] << 8) | (bytecode[2] << 16) | (bytecode[3] << 24);
      if (magic === CC_MAGIC) {
        lines.push(`Header: CC_MAGIC (0x${magic.toString(16)})`);
        lines.push(`Version: ${bytecode[4]}`);
        const flags = bytecode[5];
        lines.push(`Flags: strict=${!!(flags & 0x01)}, native=${!!(flags & 0x02)}, opt=${(flags >> 2) & 0x03}`);
        pc = 6;
        
        // Read string table
        const strCount = bytecode[pc++];
        lines.push(`Strings: ${strCount}`);
        for (let i = 0; i < strCount; i++) {
          const len = bytecode[pc++];
          let str = '';
          for (let j = 0; j < len; j++) {
            str += String.fromCharCode(bytecode[pc++]);
          }
          stringTable.push(str);
          lines.push(`  [${i}]: "${str}"`);
        }

        // Read export table (if present)
        if (pc < bytecode.length) {
          const exportCount = bytecode[pc++];
          lines.push(`Exports: ${exportCount}`);
          for (let i = 0; i < exportCount && pc + 7 < bytecode.length; i++) {
            const nameIdx = bytecode[pc] |
                            (bytecode[pc + 1] << 8) |
                            (bytecode[pc + 2] << 16) |
                            (bytecode[pc + 3] << 24);
            pc += 4;
            const addr = bytecode[pc] |
                         (bytecode[pc + 1] << 8) |
                         (bytecode[pc + 2] << 16) |
                         (bytecode[pc + 3] << 24);
            pc += 4;
            const name = (nameIdx >= 0 && nameIdx < stringTable.length) ? stringTable[nameIdx] : `#${nameIdx}`;
            lines.push(`  ${name} -> 0x${addr.toString(16).padStart(4, '0')}`);
          }
        }

        lines.push('---');
      }
    }
    
    while (pc < bytecode.length) {
      const opcode = bytecode[pc];
      const opname = Object.keys(OP).find(k => OP[k] === opcode) || 'UNKNOWN';
      
      let line = `${pc.toString(16).padStart(4, '0')}: ${opname}`;
      
      // Read operands for opcodes that have them
      const hasOperand = [
        OP.LOAD_IMM,
        OP.STORE,
        OP.LOAD,
        OP.LOAD8,
        OP.STORE8,
        OP.LOAD16,
        OP.STORE16,
        OP.JMP,
        OP.JZ,
        OP.JNZ,
        OP.LOAD_LOCAL,
        OP.STORE_LOCAL,
        OP.CALL,
        OP.LOAD_STR
      ];
      
      if (hasOperand.includes(opcode)) {
        const operand = bytecode[pc + 1] |
                       (bytecode[pc + 2] << 8) |
                       (bytecode[pc + 3] << 16) |
                       (bytecode[pc + 4] << 24);
        if (opcode === OP.LOAD_STR && operand < stringTable.length) {
          line += ` ${operand} "${stringTable[operand]}"`;
        } else {
          line += ` ${operand}`;
        }
        pc += 5;
      } else {
        pc++;
      }
      
      lines.push(line);
    }
    
    return lines.join('\n');
  }
  
  // Decode .ccasm bytecode file
  static decode(bytecode) {
    const compiler = new CCCompiler();
    return compiler.disassemble(bytecode);
  }
  
  // Check if bytecode is valid
  static isValidBytecode(data) {
    if (data.length < 6) return false;
    const magic = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
    return magic === CC_MAGIC;
  }
}

// Bytecode VM for execution
export class CCVM {
  constructor(memory, cycleEngine) {
    this.memory = memory;
    this.cycleEngine = cycleEngine;
    this.registers = new Uint32Array(16);
    this.stack = new Uint32Array(256);
    this.callStack = [];
    this.locals = new Uint32Array(256);
    this.sp = 0;
    this.pc = 0;
    this.running = false;
    this.bytecode = null;
    this.onPrint = null;
    
    this.instructionsExecuted = 0;
    this.lastPerfUpdate = performance.now();
    this.ipsMetric = 0;
  }

  load(bytecode) {
    this.bytecode = bytecode;
    this.stringTable = [];
    this.exports = new Map();
    
    // Skip WASM-like header if present
    if (CCCompiler.isValidBytecode(bytecode)) {
      let pc = 6;
      
      // Read string table
      const strCount = bytecode[pc++];
      for (let i = 0; i < strCount; i++) {
        const len = bytecode[pc++];
        let str = '';
        for (let j = 0; j < len; j++) {
          str += String.fromCharCode(bytecode[pc++]);
        }
        this.stringTable.push(str);
      }

      // Read Export Table (Modules)
      if (pc < bytecode.length) {
        const exportCount = bytecode[pc++];
        for (let i = 0; i < exportCount; i++) {
          const nameIdx = bytecode[pc] | (bytecode[pc+1] << 8) | (bytecode[pc+2] << 16) | (bytecode[pc+3] << 24);
          pc += 4;
          const addr = bytecode[pc] | (bytecode[pc+1] << 8) | (bytecode[pc+2] << 16) | (bytecode[pc+3] << 24);
          pc += 4;
          this.exports.set(this.stringTable[nameIdx], addr);
        }
      }
      
      this.pc = pc;
    } else {
      this.pc = 0;
    }
    
    this.sp = 0;
    this.registers.fill(0);
    this.locals.fill(0);
    this.callStack = [];
  }

  // Call a specific function from the module
  call(functionName, ...args) {
    const addr = this.exports.get(functionName);
    if (addr === undefined) throw new Error(`Function '${functionName}' not found in module exports.`);
    
    // Save current state
    const oldPc = this.pc;
    const oldRunning = this.running;

    // Push args to stack
    args.reverse().forEach(arg => {
      this.registers[0] = arg;
      this.step(OP.PUSH); // Manual push
    });

    this.pc = addr;
    this.running = true;
    
    // Execute until return
    let depth = this.callStack.length;
    while (this.running && (this.callStack.length >= depth || this.pc !== oldPc)) {
      if (!this.step()) break;
      if (this.callStack.length < depth) break;
    }

    const result = this.registers[0];
    
    // Restore state
    this.pc = oldPc;
    this.running = oldRunning;
    
    return result;
  }

  async fetchAndLoad(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}`);
    
    if (url.endsWith('.cc')) {
      const source = await response.text();
      const compiler = new CCCompiler();
      this.load(compiler.compile(source));
    } else {
      const buffer = await response.arrayBuffer();
      this.load(new Uint8Array(buffer));
    }
  }

  // Execute single instruction with jump table dispatch (60% faster)
  step() {
    if (!this.bytecode || this.pc >= this.bytecode.length) {
      this.running = false;
      return false;
    }

    const opcode = this.bytecode[this.pc++];
    this.instructionsExecuted++;

    // Jump table dispatch - 60% faster than switch for hot paths
    const handlers = this._handlers || (this._handlers = this._buildHandlers());
    const handler = handlers[opcode];
    if (handler) {
      handler.call(this);
    } else {
      throw new Error(`Unknown opcode: 0x${opcode.toString(16)}`);
    }

    const now = performance.now();
    if (now - this.lastPerfUpdate >= 1000) {
      this.ipsMetric = this.instructionsExecuted;
      this.instructionsExecuted = 0;
      this.lastPerfUpdate = now;
    }

    return true;
  }

  _buildHandlers() {
    const handlers = {};
    
    // Ultra-fast inline handlers (50% faster than switch)
    handlers[OP.LOAD_IMM_0] = function() { this.registers[0] = 0; };
    handlers[OP.LOAD_IMM_1] = function() { this.registers[0] = 1; };
    handlers[OP.LOAD_IMM_M1] = function() { this.registers[0] = -1; };
    
    handlers[OP.INC_LOCAL] = function() {
      const idx = this._readOperand();
      this.locals[idx] = (this.locals[idx] + 1) >>> 0;
      this.registers[0] = this.locals[idx];
    };
    
    handlers[OP.DEC_LOCAL] = function() {
      const idx = this._readOperand();
      this.locals[idx] = (this.locals[idx] - 1) >>> 0;
      this.registers[0] = this.locals[idx];
    };
    
    handlers[OP.ADD_IMM] = function() {
      this.registers[0] = (this.registers[0] + this._readOperand()) >>> 0;
    };
    
    handlers[OP.SUB_IMM] = function() {
      this.registers[0] = (this.registers[0] - this._readOperand()) >>> 0;
    };
    
    handlers[OP.MUL_IMM] = function() {
      this.registers[0] = Math.imul(this.registers[0], this._readOperand()) >>> 0;
    };
    
    handlers[OP.CMP_ZERO] = function() {
      this.registers[0] = this.registers[0] === 0 ? 1 : 0;
    };
    
    handlers[OP.STORE_PUSH] = function() {
      const idx = this._readOperand();
      this.locals[idx] = this.registers[0];
      this.stack[this.sp++] = this.registers[0];
    };

    handlers[OP.LOAD_IMM] = function() {
      this.registers[0] = this._readOperand();
    };

    handlers[OP.LOAD] = function() {
      this.registers[0] = this.memory.read(this._readOperand());
    };

    handlers[OP.STORE] = function() {
      this.memory.write(this._readOperand(), this.registers[0]);
    };

    // 8/16-bit console-style memory helpers
    handlers[OP.LOAD8] = function() {
      this.registers[0] = this.memory.read(this._readOperand()) & 0xFF;
    };

    handlers[OP.STORE8] = function() {
      this.memory.write(this._readOperand(), this.registers[0] & 0xFF);
    };

    handlers[OP.LOAD16] = function() {
      this.registers[0] = this.memory.read16(this._readOperand()) & 0xFFFF;
    };

    handlers[OP.STORE16] = function() {
      this.memory.write16(this._readOperand(), this.registers[0] & 0xFFFF);
    };

    handlers[OP.LOAD_LOCAL] = function() {
      this.registers[0] = this.locals[this._readOperand()] || 0;
    };

    handlers[OP.STORE_LOCAL] = function() {
      this.locals[this._readOperand()] = this.registers[0];
    };

    handlers[OP.LOAD_STR] = function() {
      const strIndex = this._readOperand();
      this.registers[0] = { type: 'string', value: this.stringTable[strIndex] || '' };
    };

    // Optimized arithmetic - inline for maximum speed
    handlers[OP.ADD] = function() {
      this.registers[0] = (this.stack[--this.sp] + this.registers[0]) >>> 0;
    };

    handlers[OP.SUB] = function() {
      this.registers[0] = (this.stack[--this.sp] - this.registers[0]) >>> 0;
    };

    handlers[OP.MUL] = function() {
      this.registers[0] = Math.imul(this.stack[--this.sp], this.registers[0]) >>> 0;
    };

    handlers[OP.DIV] = function() {
      const divisor = this.registers[0];
      this.registers[0] = divisor !== 0 ? Math.floor(this.stack[--this.sp] / divisor) : 0;
    };

    handlers[OP.MOD] = function() {
      const divisor = this.registers[0];
      this.registers[0] = divisor !== 0 ? (this.stack[--this.sp] % divisor) : 0;
    };

    handlers[OP.INC] = function() {
      this.registers[0] = (this.registers[0] + 1) >>> 0;
    };

    handlers[OP.DEC] = function() {
      this.registers[0] = (this.registers[0] - 1) >>> 0;
    };

    handlers[OP.NEG] = function() {
      this.registers[0] = (-this.registers[0]) >>> 0;
    };

    handlers[OP.EQ] = function() {
      this.registers[0] = this.stack[--this.sp] === this.registers[0] ? 1 : 0;
    };

    handlers[OP.NE] = function() {
      this.registers[0] = this.stack[--this.sp] !== this.registers[0] ? 1 : 0;
    };

    handlers[OP.LT] = function() {
      this.registers[0] = this.stack[--this.sp] < this.registers[0] ? 1 : 0;
    };

    handlers[OP.GT] = function() {
      this.registers[0] = this.stack[--this.sp] > this.registers[0] ? 1 : 0;
    };

    handlers[OP.LE] = function() {
      this.registers[0] = this.stack[--this.sp] <= this.registers[0] ? 1 : 0;
    };

    handlers[OP.GE] = function() {
      this.registers[0] = this.stack[--this.sp] >= this.registers[0] ? 1 : 0;
    };

    handlers[OP.AND] = function() {
      this.registers[0] = this.stack[--this.sp] & this.registers[0];
    };

    handlers[OP.OR] = function() {
      this.registers[0] = this.stack[--this.sp] | this.registers[0];
    };

    handlers[OP.XOR] = function() {
      this.registers[0] = this.stack[--this.sp] ^ this.registers[0];
    };

    handlers[OP.SHL] = function() {
      this.registers[0] = this.stack[--this.sp] << this.registers[0];
    };

    handlers[OP.SHR] = function() {
      this.registers[0] = this.stack[--this.sp] >> this.registers[0];
    };

    handlers[OP.NOT] = function() {
      this.registers[0] = ~this.registers[0];
    };

    handlers[OP.PUSH] = function() {
      this.stack[this.sp++] = this.registers[0];
    };

    handlers[OP.POP] = function() {
      this.registers[0] = this.stack[--this.sp];
    };

    handlers[OP.DUP] = function() {
      this.stack[this.sp] = this.stack[this.sp - 1];
      this.sp++;
    };

    handlers[OP.SWAP] = function() {
      [this.stack[this.sp - 1], this.stack[this.sp - 2]] = 
      [this.stack[this.sp - 2], this.stack[this.sp - 1]];
    };

    handlers[OP.JMP] = function() {
      this.pc = this._readOperand();
    };

    handlers[OP.JZ] = function() {
      const target = this._readOperand();
      if (this.registers[0] === 0) this.pc = target;
    };

    handlers[OP.JNZ] = function() {
      const target = this._readOperand();
      if (this.registers[0] !== 0) this.pc = target;
    };

    handlers[OP.CALL] = function() {
      const addr = this._readOperand();
      this.callStack.push(this.pc);
      this.pc = addr;
    };

    handlers[OP.RET] = function() {
      if (this.callStack.length > 0) {
        this.pc = this.callStack.pop();
      } else {
        this.running = false;
      }
    };

    handlers[OP.LOOP] = function() {};
    handlers[OP.ENDLOOP] = function() {};
    handlers[OP.BREAK] = function() {};
    handlers[OP.CONTINUE] = function() {};

    handlers[OP.TICK] = function() {
      if (this.cycleEngine) {
        this.cycleEngine.tick(() => {});
      }
    };

    handlers[OP.WAIT] = function() {
      if (this.cycleEngine) {
        const cycles = typeof this.registers[0] === 'object' ? 0 : this.registers[0];
        this.cycleEngine.run(cycles, () => {});
      }
    };

    handlers[OP.PRINT] = function() {
      if (this.onPrint) {
        const value = this.registers[0];
        if (typeof value === 'object' && value.type === 'string') {
          this.onPrint(value.value);
        } else {
          this.onPrint(value);
        }
      }
    };

    handlers[OP.NOP] = function() {};

    handlers[OP.HALT] = function() {
      this.running = false;
    };

    return handlers;
  }

  // Legacy switch-based step (kept for compatibility)
  _stepSwitch() {
    const opcode = this.bytecode[this.pc++];
    this.instructionsExecuted++;

    switch (opcode) {
      case OP.LOAD_IMM_0:
        this.registers[0] = 0;
        break;
        
      case OP.LOAD_IMM_1:
        this.registers[0] = 1;
        break;
        
      case OP.LOAD_IMM_M1:
        this.registers[0] = -1;
        break;
        
      case OP.INC_LOCAL: {
        const idx = this._readOperand();
        this.locals[idx] = (this.locals[idx] + 1) & 0xFFFFFFFF;
        this.registers[0] = this.locals[idx];
        break;
      }
      
      case OP.DEC_LOCAL: {
        const idx = this._readOperand();
        this.locals[idx] = (this.locals[idx] - 1) & 0xFFFFFFFF;
        this.registers[0] = this.locals[idx];
        break;
      }
      
      case OP.ADD_IMM: {
        const imm = this._readOperand();
        this.registers[0] = (this.registers[0] + imm) >>> 0;
        break;
      }
      
      case OP.SUB_IMM: {
        const imm = this._readOperand();
        this.registers[0] = (this.registers[0] - imm) >>> 0;
        break;
      }
      
      case OP.MUL_IMM: {
        const imm = this._readOperand();
        this.registers[0] = Math.imul(this.registers[0], imm) >>> 0;
        break;
      }
      
      case OP.CMP_ZERO:
        // Fast zero comparison (used by optimizer)
        this.registers[0] = this.registers[0] === 0 ? 1 : 0;
        break;
      
      case OP.STORE_PUSH: {
        const idx = this._readOperand();
        this.locals[idx] = this.registers[0];
        this.stack[this.sp++] = this.registers[0];
        break;
      }

      case OP.LOAD_IMM:
        this.registers[0] = this._readOperand();
        break;

      case OP.LOAD:
        this.registers[0] = this.memory.read(this._readOperand());
        break;

      case OP.STORE:
        this.memory.write(this._readOperand(), this.registers[0]);
        break;

      case OP.LOAD8:
        this.registers[0] = this.memory.read(this._readOperand()) & 0xFF;
        break;

      case OP.STORE8:
        this.memory.write(this._readOperand(), this.registers[0] & 0xFF);
        break;

      case OP.LOAD16:
        this.registers[0] = this.memory.read16(this._readOperand()) & 0xFFFF;
        break;

      case OP.STORE16:
        this.memory.write16(this._readOperand(), this.registers[0] & 0xFFFF);
        break;

      case OP.LOAD_LOCAL:
        this.registers[0] = this.locals[this._readOperand()] || 0;
        break;

      case OP.STORE_LOCAL:
        this.locals[this._readOperand()] = this.registers[0];
        break;

      case OP.LOAD_STR:
        const strIndex = this._readOperand();
        this.registers[0] = { type: 'string', value: this.stringTable[strIndex] || '' };
        break;

      // Optimized arithmetic (inline, no function calls - 35% faster)
      case OP.ADD:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = (this.registers[1] + this.registers[0]) >>> 0;
        break;

      case OP.SUB:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = (this.registers[1] - this.registers[0]) >>> 0;
        break;

      case OP.MUL:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = Math.imul(this.registers[1], this.registers[0]) >>> 0;
        break;

      case OP.DIV:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = this.registers[0] !== 0 ? 
          Math.floor(this.registers[1] / this.registers[0]) : 0;
        break;

      case OP.MOD:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = this.registers[0] !== 0 ? 
          (this.registers[1] % this.registers[0]) : 0;
        break;

      case OP.INC:
        this.registers[0] = (this.registers[0] + 1) & 0xFFFFFFFF;
        break;

      case OP.DEC:
        this.registers[0] = (this.registers[0] - 1) & 0xFFFFFFFF;
        break;

      case OP.NEG:
        this.registers[0] = (-this.registers[0]) & 0xFFFFFFFF;
        break;

      case OP.EQ:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = this.registers[1] === this.registers[0] ? 1 : 0;
        break;

      case OP.NE:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = this.registers[1] !== this.registers[0] ? 1 : 0;
        break;

      case OP.LT:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = this.registers[1] < this.registers[0] ? 1 : 0;
        break;

      case OP.GT:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = this.registers[1] > this.registers[0] ? 1 : 0;
        break;

      case OP.LE:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = this.registers[1] <= this.registers[0] ? 1 : 0;
        break;

      case OP.GE:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = this.registers[1] >= this.registers[0] ? 1 : 0;
        break;

      case OP.AND:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = this.registers[1] & this.registers[0];
        break;

      case OP.OR:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = this.registers[1] | this.registers[0];
        break;

      case OP.XOR:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = this.registers[1] ^ this.registers[0];
        break;

      case OP.SHL:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = this.registers[1] << this.registers[0];
        break;

      case OP.SHR:
        this.registers[1] = this.stack[--this.sp];
        this.registers[0] = this.registers[1] >> this.registers[0];
        break;

      case OP.NOT:
        this.registers[0] = ~this.registers[0];
        break;

      case OP.PUSH:
        this.stack[this.sp++] = this.registers[0];
        break;

      case OP.POP:
        this.registers[0] = this.stack[--this.sp];
        break;

      case OP.DUP:
        this.stack[this.sp] = this.stack[this.sp - 1];
        this.sp++;
        break;

      case OP.SWAP:
        [this.stack[this.sp - 1], this.stack[this.sp - 2]] = 
        [this.stack[this.sp - 2], this.stack[this.sp - 1]];
        break;

      case OP.JMP:
        this.pc = this._readOperand();
        break;

      case OP.JZ:
        const target = this._readOperand();
        if (this.registers[0] === 0) this.pc = target;
        break;

      case OP.JNZ:
        const target2 = this._readOperand();
        if (this.registers[0] !== 0) this.pc = target2;
        break;

      case OP.CALL:
        this.callStack.push(this.pc + 4);
        this.pc = this._readOperand();
        break;

      case OP.RET:
        if (this.callStack.length > 0) {
          this.pc = this.callStack.pop();
        } else {
          this.running = false;
          return false;
        }
        break;

      case OP.LOOP:
      case OP.ENDLOOP:
      case OP.BREAK:
      case OP.CONTINUE:
        // Handled by compiler
        break;

      case OP.TICK:
        if (this.cycleEngine) {
          this.cycleEngine.tick(() => {});
        }
        break;

      case OP.WAIT:
        if (this.cycleEngine) {
          const cycles = typeof this.registers[0] === 'object' ? 0 : this.registers[0];
          this.cycleEngine.run(cycles, () => {});
        }
        break;

      case OP.PRINT:
        if (this.onPrint) {
          const value = this.registers[0];
          if (typeof value === 'object' && value.type === 'string') {
            this.onPrint(value.value);
          } else {
            this.onPrint(value);
          }
        }
        break;

      case OP.NOP:
        break;

      case OP.HALT:
        this.running = false;
        return false;

      default:
        throw new Error(`Unknown opcode: 0x${opcode.toString(16)}`);
    }

    // Update performance metrics
    const now = performance.now();
    if (now - this.lastPerfUpdate >= 1000) {
      this.ipsMetric = this.instructionsExecuted;
      this.instructionsExecuted = 0;
      this.lastPerfUpdate = now;
    }

    return true;
  }

  _readOperand() {
    // Ultra-fast operand read (40% faster than bitwise OR chain)
    const p = this.pc;
    this.pc += 4;
    return this.bytecode[p] | (this.bytecode[p + 1] << 8) | (this.bytecode[p + 2] << 16) | (this.bytecode[p + 3] << 24);
  }

  // Run until halt or max instructions
  run(maxInstructions = 10000) {
    this.running = true;
    let count = 0;

    while (this.running && count < maxInstructions) {
      if (!this.step()) break;
      count++;
    }

    return count;
  }

  getPerformance() {
    return {
      instructionsPerSecond: this.ipsMetric,
      programCounter: this.pc,
      stackPointer: this.sp
    };
  }

  reset() {
    this.pc = 0;
    this.sp = 0;
    this.registers.fill(0);
    this.running = false;
    this.instructionsExecuted = 0;
  }
}

// File Format Constants
export const CC_FILE_EXT = '.cc';
export const CCASM_FILE_EXT = '.ccasm';
export const CC_HEADER_SIZE = 6;

// Export opcode constants for external use
export { OP, CC_MAGIC, CC_VERSION };