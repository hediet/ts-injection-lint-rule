import * as Lint from "tslint";
import * as ts from "typescript";
import { Pattern } from "./PatternMatching";
import {
    enableHotReload,
    registerUpdateReconciler,
    hotClass
} from "@hediet/node-reload";

//enableHotReload({ entryModule: module });
//registerUpdateReconciler(module);

export class Rule extends Lint.Rules.TypedRule {
    public applyWithProgram(
        sourceFile: ts.SourceFile,
        program: ts.Program
    ): Lint.RuleFailure[] {
        require("C:\\Users\\henni\\AppData\\Local\\Yarn\\Data\\global\\node_modules\\easy-attach\\")();
        return this.applyWithWalker(
            new DependencyInjectionRule(sourceFile, this.getOptions(), program)
        );
    }
}

/**
 * Given an injected constructor parameter `@inject($MyService) foo: bar`,
 * this rule checks that `foo` is `myService` and `bar` is `typeof $MyService.T`.
 */
@hotClass(module)
class DependencyInjectionRule extends Lint.ProgramAwareRuleWalker {
    constructor(
        sourceFile: ts.SourceFile,
        options: Lint.IOptions,
        program: ts.Program
    ) {
        super(sourceFile, options, program);
    }

    public visitConstructorDeclaration(ast: ts.ConstructorDeclaration): void {
        const matches = Pattern.node(ts.SyntaxKind.Parameter, {
            decorators: Pattern.list([
                Pattern.node(ts.SyntaxKind.Decorator, {
                    expression: Pattern.identifier()
                        .and(Pattern.test(n => n.text.startsWith("$")))
                        .named("service1")
                })
            ]),
            name: Pattern.identifier().named("paramName"),
            type: Pattern.node(ts.SyntaxKind.TypeQuery, {
                exprName: Pattern.node(ts.SyntaxKind.QualifiedName, {
                    left: Pattern.identifier().named("service2"),
                    right: Pattern.identifier("T")
                })
            }).or(Pattern.any().named("invalidType"))
        })
            .mustBe<ts.ParameterDeclaration>()
            .named("param")
            .findAllMatches(ast);

        for (const m of matches) {
            const serviceName = m.getSingle("service1").getText();
            const normalizedServiceName =
                serviceName.substr(1, 1).toLowerCase() + serviceName.substr(2);

            const replacements = new Array<Lint.Replacement>();
            const messages = new Array<string>();

            const paramName = m.getSingle("paramName");
            if (paramName.text !== normalizedServiceName) {
                const start = paramName.getStart();
                const len = paramName.getEnd() - start;
                replacements.push(
                    new Lint.Replacement(
                        start,
                        len,
                        " " + normalizedServiceName
                    )
                );
                messages.push(
                    `Injected parameter name should be "${normalizedServiceName}"`
                );
            }

            if (
                m.has("invalidType") ||
                m.getSingle("service2").getText() !== serviceName
            ) {
                let [start, len] = [paramName.getEnd(), 0];
                const typeName = `typeof ${serviceName}.T`;
                let text = typeName;
                const param = m.getSingle("param");
                if (param.type) {
                    [start, len] = [
                        param.type.getStart(),
                        param.type.getEnd() - start
                    ];
                } else {
                    text = `: ${text}`;
                }
                replacements.push(new Lint.Replacement(start, len, text));
                messages.push(`Injected type should be "${typeName}"`);
            }

            if (messages.length > 0) {
                this.addFailureAtNode(
                    m.getSingle("param"),
                    messages.join(", "),
                    replacements
                );
            }
        }
    }
}
