import * as ts from "typescript";

function isNode(obj: unknown): obj is ts.Node {
    return !!(typeof obj === "object" && obj && "pos" in obj);
}

export abstract class Match<TRoot, TVars> {
    constructor(public readonly matchedValue: TRoot) {}

    visualize(): unknown {
        if (!isNode(this.matchedValue)) {
            return;
        }
        const obj = { matchedValue: this.matchedValue } as any;

        for (const [key, items] of Object.entries(this.getCaptures())) {
            const result = new Array<unknown>();
            for (const item of items as unknown[]) {
                const arr = Array.isArray(item) ? item : [item];
                for (const i of arr) {
                    if (isNode(i)) {
                        result.push(i);
                    }
                }
            }
            obj[key] = result;
        }

        return obj;
    }

    public has<TVarName extends keyof TVars>(name: TVarName): boolean {
        return this.getAll(name).length > 0;
    }

    public getSingle<TVarName extends keyof TVars>(
        name: TVarName
    ): TVars[TVarName] {
        const all = this.getAll(name);
        if (all.length !== 1) {
            throw new Error(
                `Expected "${name}" to match exactly once, but matched ${all.length} times.`
            );
        }
        return all[0];
    }

    public getAll<TVarName extends keyof TVars>(
        name: TVarName
    ): TVars[TVarName][] {
        const arr = this.getCaptures()[name];
        if (!arr) {
            return [];
        }
        return arr;
    }

    public getCaptures(): { [TKey in keyof TVars]: TVars[TKey][] } {
        const result: Record<string, unknown[]> = {};
        this._collectCaptures(result);
        return result as any;
    }

    public abstract _collectCaptures(captures: Record<string, unknown[]>): void;
}

class MatchImpl<TRoot, TVars> extends Match<TRoot, TVars> {
    private readonly matches = new Array<Match<any, TVars>>();
    private readonly vars = new Array<{ name: string; value: unknown }>();

    public _collectCaptures(captures: Record<string, unknown[]>): void {
        for (const v of this.vars) {
            let list = captures[v.name];
            if (!list) {
                list = [];
                captures[v.name] = list;
            }
            list.push(v.value);
        }

        for (const m of this.matches) {
            m._collectCaptures(captures);
        }
    }

    addSubMatch(m: Match<any, TVars>): void {
        this.matches.push(m);
    }

    addVar(name: string, value: unknown): void {
        this.vars.push({ name, value });
    }
}

type Vars = Record<never, unknown>;
type UnionToIntersection<U> = (U extends any
    ? (k: U) => void
    : never) extends ((k: infer I) => void)
    ? I
    : never;

export abstract class Pattern<
    TValue,
    TOut = TValue,
    TVars extends Vars = Vars
> {
    public findAllMatches(
        this: Pattern<ts.Node, TOut, TVars>,
        ast: ts.Node
    ): Match<TOut, TVars>[] {
        const result = new Array<Match<TOut, TVars>>();
        const self = this;
        function traverse(node: ts.Node) {
            const m = self.match(node);
            if (m) {
                result.push(m);
                return;
            }

            node.forEachChild(traverse);
        }

        traverse(ast);
        return result;
    }

    public static node<
        TProps extends Record<string, Pattern<ts.Node, any, any>>
    >(
        kind: ts.SyntaxKind,
        properties: TProps
    ): Pattern<
        ts.Node,
        ts.Node,
        // @ts-ignore
        UnionToIntersection<TProps[keyof TProps]["TVars"]>
    > {
        return new NodePattern(kind, properties) as any;
    }

    public static identifier(value?: string): Pattern<ts.Node, ts.Identifier> {
        const val = value;
        return val
            ? new PredicatePattern(
                  n => ts.isIdentifier(n) && n.getText() === val
              )
            : new PredicatePattern(n => ts.isIdentifier(n));
    }

    public static any<T>(): Pattern<T, T> {
        return new PredicatePattern(n => true);
    }

    public static test<T>(fn: (n: T) => boolean): Pattern<T, T> {
        return new PredicatePattern(n => fn(n));
    }

    public static ofType<T>(type: { new (): T } | Function): Pattern<T, T> {
        return new PredicatePattern(n => n instanceof type);
    }

    public mustBe<T>(): Pattern<TValue, T, TVars> {
        return this as any;
    }

    public static list<TVars extends Vars, TVarsRest extends Vars>(
        patterns: Pattern<ts.Node, any, TVars>[],
        options?: {
            rest?: {
                pattern: Pattern<ts.Node[], unknown, TVarsRest>;
                mode: "suffix";
            };
        }
    ): Pattern<unknown, ts.Node[], TVars & TVarsRest> {
        return new FnPattern(node => {
            if (!Array.isArray(node)) {
                return false;
            }

            const c = node as ts.Node[];

            if (options && options.rest) {
                if (c.length < patterns.length) {
                    return false;
                }
            } else {
                if (c.length !== patterns.length) {
                    return false;
                }
            }

            const match = new MatchImpl<ts.Node[], TVars & TVarsRest>(node);
            for (let idx = 0; idx < patterns.length; idx++) {
                const node = c[idx];
                const pattern = patterns[idx];
                const m = pattern.match(node);
                if (!m) {
                    return false;
                }
                match.addSubMatch(m as any);
            }

            if (options && options.rest) {
                const m = options.rest.pattern.match(c.slice(patterns.length));
                if (!m) {
                    return false;
                }
                match.addSubMatch(m as any);
            }

            return match;
        });
    }

    public get TVars(): TVars {
        throw new Error();
    }

    abstract match(value: TValue): Match<TOut, TVars> | false;

    public or<TValue2, TOut2, TVars2 extends Vars>(
        other: Pattern<TValue2, TOut2, TVars2>
    ): Pattern<TValue & TValue2, TOut | TOut2, TVars & TVars2> {
        return new FnPattern(value => {
            const m = this.match(value);
            if (m) {
                return m;
            }
            return other.match(value) as any;
        });
    }

    public and<TOut2, TVars2 extends Vars>(
        other: Pattern<TOut, TOut2, TVars2>
    ): Pattern<TValue, TOut2, TVars & TVars2> {
        return new FnPattern(value => {
            const m = this.match(value);
            if (!m) {
                return false;
            }
            const m2 = new MatchImpl<TOut, any>(m.matchedValue);
            m2.addSubMatch(m);

            const m3 = other.match(m.matchedValue);
            if (!m3) {
                return false;
            }
            m2.addSubMatch(m3);

            return m2 as any;
        });
    }

    public named<TName extends string>(
        name: TName
    ): Pattern<TValue, TOut, { [TKey in TName]: TOut } & TVars> {
        return new FnPattern(value => {
            const m = this.match(value);
            if (!m) {
                return false;
            }
            const m2 = new MatchImpl<TOut, any>(m.matchedValue);
            m2.addSubMatch(m);
            m2.addVar(name, value);
            return m2 as any;
        });
    }
}

class PredicatePattern<T, TOut = T> extends Pattern<T, TOut> {
    constructor(public readonly test: (value: T) => boolean) {
        super();
    }

    match(value: T): Match<TOut, {}> | false {
        const result = this.test(value);
        if (result) {
            return new MatchImpl((value as any) as TOut);
        }
        return false;
    }
}

class FnPattern<T, TOut, TVars extends Vars> extends Pattern<T, TOut, TVars> {
    constructor(
        public readonly matchFn: (value: T) => Match<TOut, TVars> | false
    ) {
        super();
    }

    match(value: T): Match<TOut, TVars> | false {
        return this.matchFn(value);
    }
}

class NodePattern<TVars extends Vars> extends Pattern<unknown, ts.Node, TVars> {
    constructor(
        public readonly kind: ts.SyntaxKind,
        public readonly properties: Record<string, Pattern<any, TVars>>
    ) {
        super();
    }

    match(value: unknown): Match<ts.Node, TVars> | false {
        if (!isNode(value)) {
            return false;
        }
        if (value.kind !== this.kind) {
            return false;
        }
        const m = new MatchImpl<ts.Node, TVars>(value);
        for (const [key, pattern] of Object.entries(this.properties)) {
            const prop = (value as any)[key];

            const match = pattern.match(prop);
            if (!match) {
                return false;
            }
            m.addSubMatch(match as any);
        }

        return m;
    }
}
