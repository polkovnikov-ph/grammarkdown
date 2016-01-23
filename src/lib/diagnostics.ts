﻿/*!
 *  Copyright 2015 Ron Buckton (rbuckton@chronicles.org)
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */
import { binarySearch, Range, Position } from "./core";
import { CharacterCodes, SyntaxKind, tokenToString } from "./tokens";
import { Node, SourceFile } from "./nodes";

export interface Diagnostic {
    code: number;
    message: string;
    warning?: boolean;
}

export const Diagnostics = {
    Constant_expected: <Diagnostic>{ code: 1000, message: "Constant expected." },
    _0_expected: <Diagnostic>{ code: 1001, message: "{0} expected." },
    _0_or_1_: <Diagnostic>{ code: 0, message: "{0} or {1}" },
    Unexpected_token_0_: <Diagnostic>{ code: 1002, message: "Unexpected token {0}." },
    Invalid_character: <Diagnostic>{ code: 1003, message: "Invalid character." },
    Unterminated_string_literal: <Diagnostic>{ code: 1004, message: "Unterminated string literal." },
    Invalid_escape_sequence: <Diagnostic>{ code: 1005, message: "Invalid escape sequence." },
    Digit_expected: <Diagnostic>{ code: 1006, message: "Digit expected." },
    Production_expected: <Diagnostic>{ code: 1007, message: "Production expected." },
    Unterminated_identifier_literal: <Diagnostic>{ code: 1008, message: "Unterminated identifier literal." },
    Obsolete_0_: <Diagnostic>{ code: 1009, message: "Obsolete: {0}", warning: true },
    Cannot_find_name_0_: <Diagnostic>{ code: 2000, message: "Cannot find name: '{0}'." },
    Duplicate_identifier_0_: <Diagnostic>{ code: 2001, message: "Duplicate identifier: '{0}'." },
    Duplicate_terminal_0_: <Diagnostic>{ code: 2002, message: "Duplicate terminal: `{0}`." },
};

export interface DiagnosticInfo {
    diagnosticIndex: number;
    code: number;
    message: string;
    messageArguments: any[];
    warning: boolean;
    range: Range;
    sourceFile: SourceFile;
    node: Node;
    pos: number;
    formattedMessage?: string;
}

export class DiagnosticMessages {
    private diagnostics: Diagnostic[];
    private diagnosticsPos: number[];
    private diagnosticsNode: Node[];
    private diagnosticsArguments: any[][];
    private sourceFiles: SourceFile[];
    private sourceFilesDiagnosticOffset: number[];
    private nextDiagnosticIndex = 0;

    constructor() {
    }

    public setSourceFile(sourceFile: SourceFile): void {
        if (!this.sourceFiles) {
            this.sourceFiles = [];
            this.sourceFilesDiagnosticOffset = [];
        }

        let diagnosticOffset = this.count();
        let sourceFileIndex = this.sourceFiles.length;
        this.sourceFiles[sourceFileIndex] = sourceFile;
        this.sourceFilesDiagnosticOffset[sourceFileIndex] = diagnosticOffset;
    }

    public report(pos: number, message: Diagnostic, args: any[]): void;
    public report(pos: number, message: Diagnostic, ...args: any[]): void;
    public report(pos: number, message: Diagnostic): void {
        this.reportDiagnostic(message, Array.prototype.slice.call(arguments, 2), pos);
    }


    public reportNode(node: Node, message: Diagnostic, args: any[]): void;
    public reportNode(node: Node, message: Diagnostic, ...args: any[]): void;
    public reportNode(node: Node, message: Diagnostic): void {
        var pos: number;
        if (node) {
            pos = node.pos;
        }

        this.reportDiagnostic(message, Array.prototype.slice.call(arguments, 2), pos, node);
    }

    public count(): number {
        return this.diagnostics ? this.diagnostics.length : 0;
    }

    public getMessage(diagnosticIndex: number, options: { detailed?: boolean; } = { detailed: true }): string {
        let diagnostic = this.diagnostics && this.diagnostics[diagnosticIndex];
        if (diagnostic) {
            const { detailed = true } = options;
            let diagnosticArguments = this.diagnosticsArguments && this.diagnosticsArguments[diagnosticIndex];
            let sourceFile = this.getDiagnosticSourceFile(diagnosticIndex);
            let text = "";
            if (detailed) {
                text += sourceFile ? sourceFile.filename : "";
                if (this.diagnosticsPos && diagnosticIndex in this.diagnosticsPos) {
                    let diagnosticPos = this.diagnosticsPos[diagnosticIndex];
                    if (sourceFile && sourceFile.lineMap) {
                        text += `(${sourceFile.lineMap.formatPosition(diagnosticPos) })`;
                    }
                    else {
                        text += `(${diagnosticPos})`;
                    }
                }

                text += ": ";
                text += diagnostic.warning ? "warning" : "error";
                text += " GM" + String(diagnostic.code) + ": ";
            }

            let message = diagnostic.message;
            if (diagnosticArguments) {
                message = formatString(message, diagnosticArguments);
            }

            text += message;
            return text;
        }

        return "";
    }

    public getDiagnostic(diagnosticIndex: number): Diagnostic {
        return this.diagnostics && this.diagnostics[diagnosticIndex];
    }

    public getDiagnosticInfos(options?: { formatMessage?: boolean; detailedMessage?: boolean; }): DiagnosticInfo[] {
        const result: DiagnosticInfo[] = [];
        for (let i = 0; i < this.count(); i++) {
            result.push(this.getDiagnosticInfo(i, options));
        }

        return result;
    }

    public getDiagnosticInfosForSourceFile(sourceFile: SourceFile, options?: { formatMessage?: boolean; detailedMessage?: boolean; }): DiagnosticInfo[] {
        const result: DiagnosticInfo[] = [];
        for (let i = 0; i < this.count(); i++) {
            if (this.getDiagnosticSourceFile(i) === sourceFile) {
                result.push(this.getDiagnosticInfo(i, options));
            }
        }

        return result;
    }

    public getDiagnosticInfo(diagnosticIndex: number, options: { formatMessage?: boolean; detailedMessage?: boolean; } = {}): DiagnosticInfo {
        const diagnostic = this.getDiagnostic(diagnosticIndex);
        if (diagnostic) {
            const info: DiagnosticInfo = {
                diagnosticIndex,
                code: diagnostic.code,
                warning: diagnostic.warning || false,
                message: diagnostic.message,
                messageArguments: this.getDiagnosticArguments(diagnosticIndex),
                range: this.getDiagnosticRange(diagnosticIndex),
                sourceFile: this.getDiagnosticSourceFile(diagnosticIndex),
                node: this.getDiagnosticNode(diagnosticIndex),
                pos: this.getDiagnosticPos(diagnosticIndex)
            };

            if (options.formatMessage) {
                info.formattedMessage = this.getMessage(diagnosticIndex, { detailed: options.detailedMessage });
            }

            return info;
        }

        return undefined;
    }

    public getDiagnosticArguments(diagnosticIndex: number): any[] {
        return this.diagnosticsArguments && this.diagnosticsArguments[diagnosticIndex];
    }

    public getDiagnosticRange(diagnosticIndex: number) {
        const diagnostic = this.getDiagnostic(diagnosticIndex);
        const sourceFile = this.getDiagnosticSourceFile(diagnosticIndex);
        const node = this.getDiagnosticNode(diagnosticIndex);
        const pos = this.getDiagnosticPos(diagnosticIndex);
        if (diagnostic && node || pos > -1) {
            return getDiagnosticRange(node, pos, sourceFile);
        }

        return undefined;
    }

    public getDiagnosticNode(diagnosticIndex: number): Node {
        return this.diagnosticsNode && this.diagnosticsNode[diagnosticIndex];
    }

    public forEach(callback: (message: string, diagnosticIndex: number) => void): void {
        if (this.diagnostics) {
            for (let diagnosticIndex = 0, l = this.diagnostics.length; diagnosticIndex < l; diagnosticIndex++) {
                callback(this.getMessage(diagnosticIndex, { detailed: true }), diagnosticIndex);
            }
        }
    }

    private getDiagnosticPos(diagnosticIndex: number): number {
        return this.diagnosticsPos && this.diagnosticsPos[diagnosticIndex] || -1;
    }

    private reportDiagnostic(message: Diagnostic, args: any[], pos?: number, node?: Node): void {
        if (!this.diagnostics) {
            this.diagnostics = [];
        }

        let diagnosticIndex = this.diagnostics.length;
        this.diagnostics[diagnosticIndex] = message;

        if (args.length === 1 && args[0] instanceof Array) {
            args = args[0];
        }

        if (args.length > 0) {
            if (!this.diagnosticsArguments) {
                this.diagnosticsArguments = [];
            }

            this.diagnosticsArguments[diagnosticIndex] = args;
        }

        if (pos !== undefined) {
            if (!this.diagnosticsPos) {
                this.diagnosticsPos = [];
            }

            this.diagnosticsPos[diagnosticIndex] = pos;
        }

        if (node !== undefined) {
            if (!this.diagnosticsNode) {
                this.diagnosticsNode = [];
            }

            this.diagnosticsNode[diagnosticIndex] = node;
        }
    }

    public getDiagnosticSourceFile(diagnosticIndex: number): SourceFile {
        if (this.sourceFiles) {
            let offset = binarySearch(this.sourceFilesDiagnosticOffset, diagnosticIndex);
            if (offset < 0) {
                offset = (~offset) - 1;
            }

            while (offset + 1 < this.sourceFiles.length && this.sourceFilesDiagnosticOffset[offset + 1] === diagnosticIndex) {
                offset++;
            }

            return this.sourceFiles[offset];
        }

        return undefined;
    }
}

export class NullDiagnosticMessages extends DiagnosticMessages {
    private static _instance: NullDiagnosticMessages;

    public static get instance() {
        return this._instance || (this._instance = new NullDiagnosticMessages());
    }

    public reportCore(message: Diagnostic, arg0?: any, arg1?: any): number { return 0; }
    public report(pos: number, message: Diagnostic, arg0?: any, arg1?: any): number { return 0; }
    public reportNode(node: Node, message: Diagnostic, arg0?: any, arg1?: any): number { return 0; }
    public count(): number { return 0; }
    public getMessage(diagnosticIndex: number): string { return ""; }
    public getDiagnostic(diagnosticIndex: number): Diagnostic { return undefined; }
    public getDiagnosticNode(diagnosticIndex: number): Node { return undefined; }
    public forEach(callback: (message: string, diagnosticIndex: number) => void): void { }
}

export class LineMap {
    private text: string;
    private lineStarts: number[];

    constructor(text: string) {
        this.text = text;
    }

    public formatPosition(pos: number): string {
        this.computeLineStarts();
        var lineNumber = binarySearch(this.lineStarts, pos);
        if (lineNumber < 0) {
            // If the actual position was not found,
            // the binary search returns the negative value of the next line start
            // e.g. if the line starts at [5, 10, 23, 80] and the position requested was 20
            // then the search will return -2
            lineNumber = (~lineNumber) - 1;
        }
        return `${lineNumber + 1},${pos - this.lineStarts[lineNumber] + 1}`;
    }

    public getPositionOfLineAndCharacter(lineAndCharacter: Position) {
        this.computeLineStarts();
        if (lineAndCharacter.line < 0 ||
            lineAndCharacter.character < 0 ||
            lineAndCharacter.line >= this.lineStarts.length) {
            return -1;
        }

        const pos = this.lineStarts[lineAndCharacter.line] + lineAndCharacter.character;
        const lineEnd = lineAndCharacter.line + 1 < this.lineStarts.length
            ? this.lineStarts[lineAndCharacter.line + 1]
            : this.text.length;

        if (pos >= lineEnd) {
            return -1;
        }

        if (this.text.charCodeAt(pos) === CharacterCodes.LineFeed ||
            this.text.charCodeAt(pos) === CharacterCodes.CarriageReturn) {
            return -1;
        }

        return pos;
    }

    public getLineAndCharacterOfPosition(pos: number): Position {
        this.computeLineStarts();
        let lineNumber = binarySearch(this.lineStarts, pos);
        if (lineNumber < 0) {
            // If the actual position was not found,
            // the binary search returns the negative value of the next line start
            // e.g. if the line starts at [5, 10, 23, 80] and the position requested was 20
            // then the search will return -2
            lineNumber = (~lineNumber) - 1;
        }

        return { line: lineNumber, character: pos - this.lineStarts[lineNumber] };
    }

    private computeLineStarts() {
        if (this.lineStarts) {
            return;
        }
        var lineStarts: number[] = [];
        var lineStart = 0;
        for (var pos = 0; pos < this.text.length; ) {
            var ch = this.text.charCodeAt(pos++);
            switch (ch) {
                case CharacterCodes.CarriageReturn:
                    if (this.text.charCodeAt(pos) === CharacterCodes.LineFeed) {
                        pos++;
                    }
                case CharacterCodes.LineFeed:
                case CharacterCodes.LineSeparator:
                case CharacterCodes.ParagraphSeparator:
                case CharacterCodes.NextLine:
                    lineStarts.push(lineStart);
                    lineStart = pos;
                    break;

            }
        }
        lineStarts.push(lineStart);
        this.lineStarts = lineStarts;
    }

    private isLineBreak(ch: number): boolean {
        return ch === CharacterCodes.CarriageReturn
            || ch === CharacterCodes.LineFeed
            || ch === CharacterCodes.LineSeparator
            || ch === CharacterCodes.ParagraphSeparator
            || ch === CharacterCodes.NextLine;
    }
}

function getDiagnosticRange(diagnosticNode: Node, diagnosticPos: number, sourceFile: SourceFile): Range {
    return {
        start: getLineAndCharacterOfStart(diagnosticNode, diagnosticPos, sourceFile),
        end: getLineAndCharacterOfEnd(diagnosticNode, diagnosticPos, sourceFile)
    }
}

function getLineAndCharacterOfStart(diagnosticNode: Node, diagnosticPos: number, sourceFile: SourceFile) {
    return getLineAndCharacterOfPosition(diagnosticNode ? diagnosticNode.pos : diagnosticPos, sourceFile);
}

function getLineAndCharacterOfEnd(diagnosticNode: Node, diagnosticPos: number, sourceFile: SourceFile) {
    return getLineAndCharacterOfPosition(diagnosticNode ? diagnosticNode.end : diagnosticPos, sourceFile);
}

function getLineAndCharacterOfPosition(diagnosticPos: number, sourceFile: SourceFile) {
    return sourceFile && sourceFile.lineMap
        ? sourceFile.lineMap.getLineAndCharacterOfPosition(diagnosticPos)
        : { line: 0, character: diagnosticPos };
}

export function formatString(format: string, args?: any[]): string;
export function formatString(format: string, ...args: any[]): string;
export function formatString(format: string): string {
    let args = <any[]>Array.prototype.slice.call(arguments, 1);
    if (args.length === 1 && args[0] instanceof Array) {
        args = args[0];
    }

    return format.replace(/{(\d+)}/g, (_, index) => args[index]);
}

export function formatList(tokens: SyntaxKind[]): string {
    if (tokens.length <= 0) {
        return "";
    }
    else if (tokens.length === 1) {
        return tokenToString(tokens[0], /*quoted*/ true);
    }
    else if (tokens.length === 2) {
        return formatString(
            Diagnostics._0_or_1_.message,
            tokenToString(tokens[0], /*quoted*/ true),
            tokenToString(tokens[1], /*quoted*/ true));
    }
    else {
        let text = "";
        for (var i = 0; i < tokens.length - 1; i++) {
            if (i > 0) {
                text += " ";
            }

            text += tokenToString(tokens[i], /*quoted*/ true);
            text += ",";
        }

        return formatString(Diagnostics._0_or_1_.message, text, tokenToString(tokens[tokens.length - 1], /*quoted*/ true));
    }
}
