import * as net from 'net';

export class GdbRspClient {
    protected socket: net.Socket | undefined;
    protected buffer = Buffer.alloc(0);
    protected pending: { command: string; resolve: (value: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; consoleOutput: string[] } | undefined;

    constructor(protected readonly onStop: (packet: string) => void) {}

    async connect(host: string, port: number, timeoutMs = 15000): Promise<void> {
        const until = Date.now() + timeoutMs;
        let lastError: Error | undefined;
        while (Date.now() < until) {
            try {
                const socket = await new Promise<net.Socket>((resolve, reject) => {
                    const candidate = net.createConnection({ host, port });
                    const fail = (error: Error) => {
                        candidate.destroy();
                        reject(error);
                    };
                    candidate.once('error', fail);
                    candidate.once('connect', () => {
                        candidate.removeListener('error', fail);
                        resolve(candidate);
                    });
                });
                socket.setNoDelay(true);
                socket.on('data', data => this.onData(typeof data === 'string' ? Buffer.from(data, 'utf8') : data));
                socket.on('error', error => {
                    if (this.pending) {
                        const pending = this.pending;
                        this.pending = undefined;
                        clearTimeout(pending.timer);
                        pending.reject(error);
                    }
                });
                this.socket = socket;
                return;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        throw new Error(`GDB endpoint ${host}:${port} did not accept the debugger connection within ${timeoutMs}ms${lastError ? `: ${lastError.message}` : '.'}`);
    }

    close(): void {
        this.socket?.destroy();
        this.socket = undefined;
    }

    async command(command: string): Promise<string> {
        if (!this.socket) {
            throw new Error('Inu debugger transport is not connected.');
        }
        if (this.pending) {
            throw new Error('Inu debugger already has a pending GDB command.');
        }
        return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pending) {
                    this.pending = undefined;
                    reject(new Error(`GDB command timed out: ${command}`));
                }
            }, 2500);
            this.pending = { command, resolve, reject, timer, consoleOutput: [] };
            this.socket!.write(this.packet(command));
        });
    }

    run(command: string): void {
        if (!this.socket) {
            throw new Error('Inu debugger transport is not connected.');
        }
        this.socket.write(this.packet(command));
    }

    interrupt(): void {
        if (!this.socket) {
            throw new Error('Inu debugger transport is not connected.');
        }
        this.socket.write(Buffer.from([0x03]));
    }

    protected packet(payload: string): string {
        let checksum = 0;
        for (const byte of Buffer.from(payload, 'ascii')) {
            checksum = (checksum + byte) & 0xff;
        }
        return `$${payload}#${checksum.toString(16).padStart(2, '0')}`;
    }

    protected onData(data: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, data]);
        while (this.buffer.length > 0) {
            if (this.buffer[0] === 0x2b || this.buffer[0] === 0x2d) {
                this.buffer = this.buffer.subarray(1);
                continue;
            }
            const start = this.buffer.indexOf(0x24);
            if (start < 0) {
                this.buffer = Buffer.alloc(0);
                return;
            }
            const hash = this.buffer.indexOf(0x23, start + 1);
            if (hash < 0 || this.buffer.length < hash + 3) {
                return;
            }
            const payload = this.buffer.subarray(start + 1, hash).toString('ascii');
            this.buffer = this.buffer.subarray(hash + 3);
            this.socket?.write('+');

            if (/^[TSWX]/.test(payload)) {
                // QEMU deliberately sends stop replies synchronously only when the client
                // issued a command that permits one. The '?' stop-reason query is exactly
                // such a command. Resolve that pending request as well as publishing the
                // stop event; otherwise a standards-compliant QEMU stop reply is consumed
                // as an asynchronous notification and command('?') times out forever.
                if (this.pending?.command === '?') {
                    const pending = this.pending;
                    this.pending = undefined;
                    clearTimeout(pending.timer);
                    pending.resolve(payload);
                }
                this.onStop(payload);
                continue;
            }
            if (payload.startsWith('O') && this.pending && /^[0-9a-fA-F]*$/.test(payload.slice(1)) && payload.length % 2 === 1) {
                try { this.pending.consoleOutput.push(Buffer.from(payload.slice(1), 'hex').toString('utf8')); } catch { }
                continue;
            }
            if (this.pending) {
                const pending = this.pending;
                this.pending = undefined;
                clearTimeout(pending.timer);
                pending.resolve(pending.consoleOutput.length > 0 && payload === 'OK' ? pending.consoleOutput.join('') : payload);
            }
        }
    }
}


export class InuExpressionParser {
    protected readonly tokens: string[];
    protected index = 0;

    constructor(
        expression: string,
        protected readonly resolveIdentifier: (name: string) => Promise<bigint | undefined>,
        protected readonly readPointer: (address: bigint) => Promise<bigint>
    ) {
        this.tokens = this.tokenize(expression);
    }

    async evaluate(): Promise<bigint> {
        if (this.tokens.length === 0) { throw new Error('Expression is empty.'); }
        const value = await this.parseLogicalOr();
        if (this.index !== this.tokens.length) {
            throw new Error(`Unexpected token "${this.tokens[this.index]}".`);
        }
        return value;
    }

    protected tokenize(expression: string): string[] {
        const tokens: string[] = [];
        let i = 0;
        while (i < expression.length) {
            const ch = expression[i];
            if (/\s/.test(ch)) { i++; continue; }
            const two = expression.slice(i, i + 2);
            if (['||','&&','==','!=','<=','>=','<<','>>'].includes(two)) { tokens.push(two); i += 2; continue; }
            if ('()+-*/%~!<>&|^[]'.includes(ch)) { tokens.push(ch); i++; continue; }
            if (/[0-9]/.test(ch)) {
                let j = i + 1;
                if (ch === '0' && /[xX]/.test(expression[j] ?? '')) {
                    j++;
                    while (/[0-9a-fA-F]/.test(expression[j] ?? '')) { j++; }
                } else {
                    while (/[0-9]/.test(expression[j] ?? '')) { j++; }
                }
                tokens.push(expression.slice(i, j)); i = j; continue;
            }
            if (/[A-Za-z_$]/.test(ch)) {
                let j = i + 1;
                while (/[A-Za-z0-9_.$]/.test(expression[j] ?? '')) { j++; }
                tokens.push(expression.slice(i, j)); i = j; continue;
            }
            throw new Error(`Unsupported character "${ch}" in expression.`);
        }
        return tokens;
    }

    protected peek(value?: string): boolean {
        const token = this.tokens[this.index];
        return value === undefined ? token !== undefined : token === value;
    }

    protected take(): string {
        const token = this.tokens[this.index++];
        if (token === undefined) { throw new Error('Unexpected end of expression.'); }
        return token;
    }

    protected async parseLogicalOr(): Promise<bigint> {
        let value = await this.parseLogicalAnd();
        while (this.peek('||')) { this.take(); const rhs = await this.parseLogicalAnd(); value = value !== 0n || rhs !== 0n ? 1n : 0n; }
        return value;
    }
    protected async parseLogicalAnd(): Promise<bigint> {
        let value = await this.parseBitwiseOr();
        while (this.peek('&&')) { this.take(); const rhs = await this.parseBitwiseOr(); value = value !== 0n && rhs !== 0n ? 1n : 0n; }
        return value;
    }
    protected async parseBitwiseOr(): Promise<bigint> {
        let value = await this.parseBitwiseXor();
        while (this.peek('|')) { this.take(); value |= await this.parseBitwiseXor(); }
        return value;
    }
    protected async parseBitwiseXor(): Promise<bigint> {
        let value = await this.parseBitwiseAnd();
        while (this.peek('^')) { this.take(); value ^= await this.parseBitwiseAnd(); }
        return value;
    }
    protected async parseBitwiseAnd(): Promise<bigint> {
        let value = await this.parseEquality();
        while (this.peek('&')) { this.take(); value &= await this.parseEquality(); }
        return value;
    }
    protected async parseEquality(): Promise<bigint> {
        let value = await this.parseRelational();
        while (this.peek('==') || this.peek('!=')) {
            const op = this.take(); const rhs = await this.parseRelational();
            value = op === '==' ? (value === rhs ? 1n : 0n) : (value !== rhs ? 1n : 0n);
        }
        return value;
    }
    protected async parseRelational(): Promise<bigint> {
        let value = await this.parseShift();
        while (['<','<=','>','>='].includes(this.tokens[this.index] ?? '')) {
            const op = this.take(); const rhs = await this.parseShift();
            value = op === '<' ? (value < rhs ? 1n : 0n)
                : op === '<=' ? (value <= rhs ? 1n : 0n)
                : op === '>' ? (value > rhs ? 1n : 0n)
                : (value >= rhs ? 1n : 0n);
        }
        return value;
    }
    protected async parseShift(): Promise<bigint> {
        let value = await this.parseAdditive();
        while (this.peek('<<') || this.peek('>>')) {
            const op = this.take(); const rhs = await this.parseAdditive();
            const shift = BigInt.asUintN(64, rhs);
            if (shift > 63n) { throw new Error('Shift count must be between 0 and 63.'); }
            value = op === '<<' ? value << shift : value >> shift;
        }
        return value;
    }
    protected async parseAdditive(): Promise<bigint> {
        let value = await this.parseMultiplicative();
        while (this.peek('+') || this.peek('-')) { const op = this.take(); const rhs = await this.parseMultiplicative(); value = op === '+' ? value + rhs : value - rhs; }
        return value;
    }
    protected async parseMultiplicative(): Promise<bigint> {
        let value = await this.parseUnary();
        while (this.peek('*') || this.peek('/') || this.peek('%')) {
            const op = this.take(); const rhs = await this.parseUnary();
            if ((op === '/' || op === '%') && rhs === 0n) { throw new Error('Division by zero.'); }
            value = op === '*' ? value * rhs : op === '/' ? value / rhs : value % rhs;
        }
        return value;
    }
    protected async parseUnary(): Promise<bigint> {
        if (this.peek('!')) { this.take(); return (await this.parseUnary()) === 0n ? 1n : 0n; }
        if (this.peek('~')) { this.take(); return ~(await this.parseUnary()); }
        if (this.peek('-')) { this.take(); return -(await this.parseUnary()); }
        if (this.peek('+')) { this.take(); return await this.parseUnary(); }
        return this.parsePrimary();
    }
    protected async parsePrimary(): Promise<bigint> {
        if (this.peek('(')) {
            this.take(); const value = await this.parseLogicalOr();
            if (!this.peek(')')) { throw new Error('Missing closing parenthesis.'); }
            this.take(); return value;
        }
        if (this.peek('[')) {
            this.take(); const address = await this.parseLogicalOr();
            if (!this.peek(']')) { throw new Error('Missing closing bracket in memory expression.'); }
            this.take(); return this.readPointer(BigInt.asUintN(64, address));
        }
        const token = this.take();
        if (/^0x[0-9a-f]+$/i.test(token)) { return BigInt(token); }
        if (/^[0-9]+$/.test(token)) { return BigInt(token); }
        if (token.toLowerCase() === 'true') { return 1n; }
        if (token.toLowerCase() === 'false') { return 0n; }
        const resolved = await this.resolveIdentifier(token.replace(/^\$/, '').toLowerCase());
        if (resolved === undefined) { throw new Error(`Unknown identifier "${token}". Current expressions support x64 registers, active named NativeAOT locals/arguments, integer literals, operators and [address] 64-bit memory reads.`); }
        return resolved;
    }
}

