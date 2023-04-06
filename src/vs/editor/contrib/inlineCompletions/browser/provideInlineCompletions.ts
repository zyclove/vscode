/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertNever } from 'vs/base/common/assert';
import { CancellationToken } from 'vs/base/common/cancellation';
import { onUnexpectedExternalError } from 'vs/base/common/errors';
import { IDisposable } from 'vs/base/common/lifecycle';
import { ISingleEditOperation } from 'vs/editor/common/core/editOperation';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { LanguageFeatureRegistry } from 'vs/editor/common/languageFeatureRegistry';
import { Command, InlineCompletion, InlineCompletionContext, InlineCompletions, InlineCompletionsProvider } from 'vs/editor/common/languages';
import { ILanguageConfigurationService } from 'vs/editor/common/languages/languageConfigurationRegistry';
import { ITextModel } from 'vs/editor/common/model';
import { fixBracketsInLine } from 'vs/editor/common/model/bracketPairsTextModelPart/fixBrackets';
import { getReadonlyEmptyArray } from 'vs/editor/contrib/inlineCompletions/browser/utils';
import { SnippetParser, Text } from 'vs/editor/contrib/snippet/browser/snippetParser';

export async function provideInlineCompletions(
	registry: LanguageFeatureRegistry<InlineCompletionsProvider>,
	position: Position,
	model: ITextModel,
	context: InlineCompletionContext,
	token: CancellationToken = CancellationToken.None,
	languageConfigurationService?: ILanguageConfigurationService,
): Promise<InlineCompletionProviderResult> {
	const providers = registry.all(model);
	const providerResults = await Promise.all(providers.map(async provider => {
		try {
			const completions = await provider.provideInlineCompletions(model, position, context, token);
			return ({ provider, completions });
		} catch (e) {
			onUnexpectedExternalError(e);
		}
		return ({ provider, completions: undefined });
	}));

	const defaultReplaceRange = getDefaultRange(position, model);
	const itemsByHash = new Map<string, InlineCompletionItem>();
	const resultMap = new Map<InlineCompletionsProvider, InlineCompletions>();
	for (const result of providerResults) {
		const completions = result.completions;
		if (!completions) {
			continue;
		}
		resultMap.set(result.provider, completions);

		for (const item of completions.items) {
			const inlineCompletionItem = InlineCompletionItem.from(
				item,
				result.provider,
				completions,
				defaultReplaceRange,
				model,
				languageConfigurationService
			);
			itemsByHash.set(inlineCompletionItem.hash(), inlineCompletionItem);
		}
	}

	return new InlineCompletionProviderResult(Array.from(itemsByHash.values()), resultMap, context);
}

export class InlineCompletionProviderResult implements IDisposable {
	constructor(
		/**
		 * Free of duplicates.
		 */
		public readonly completions: InlineCompletionItem[],
		/**
		 * Tracks which provider produced which result.
		 * This is important for disposing.
		 */
		private readonly providerResults: Map<InlineCompletionsProvider, InlineCompletions>,
		public readonly context: InlineCompletionContext,
	) {
	}

	dispose(): void {
		for (const [provider, list] of this.providerResults) {
			provider.freeInlineCompletions(list);
		}
	}
}

export class InlineCompletionItem {
	public static from(
		inlineCompletion: InlineCompletion,
		sourceProvider: InlineCompletionsProvider,
		sourceInlineCompletions: InlineCompletions,
		defaultReplaceRange: Range,
		textModel: ITextModel,
		languageConfigurationService: ILanguageConfigurationService | undefined,
	) {
		let insertText: string;
		let snippetInfo: SnippetInfo | undefined;
		let range = inlineCompletion.range ? Range.lift(inlineCompletion.range) : defaultReplaceRange;

		if (typeof inlineCompletion.insertText === 'string') {
			insertText = inlineCompletion.insertText;

			if (languageConfigurationService && inlineCompletion.completeBracketPairs) {
				insertText = closeBrackets(
					insertText,
					range.getStartPosition(),
					textModel,
					languageConfigurationService
				);

				// Modify range depending on if brackets are added or removed
				const diff = insertText.length - inlineCompletion.insertText.length;
				if (diff !== 0) {
					range = new Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn + diff);
				}
			}

			snippetInfo = undefined;
		} else if ('snippet' in inlineCompletion.insertText) {
			const preBracketCompletionLength = inlineCompletion.insertText.snippet.length;

			if (languageConfigurationService && inlineCompletion.completeBracketPairs) {
				inlineCompletion.insertText.snippet = closeBrackets(
					inlineCompletion.insertText.snippet,
					range.getStartPosition(),
					textModel,
					languageConfigurationService
				);

				// Modify range depending on if brackets are added or removed
				const diff = inlineCompletion.insertText.snippet.length - preBracketCompletionLength;
				if (diff !== 0) {
					range = new Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn + diff);
				}
			}

			const snippet = new SnippetParser().parse(inlineCompletion.insertText.snippet);

			if (snippet.children.length === 1 && snippet.children[0] instanceof Text) {
				insertText = snippet.children[0].value;
				snippetInfo = undefined;
			} else {
				insertText = snippet.toString();
				snippetInfo = {
					snippet: inlineCompletion.insertText.snippet,
					range: range
				};
			}
		} else {
			assertNever(inlineCompletion.insertText);
		}

		return new InlineCompletionItem(
			insertText,
			inlineCompletion.command,
			range,
			insertText,
			snippetInfo,
			inlineCompletion.additionalTextEdits || getReadonlyEmptyArray(),
			sourceProvider,
			inlineCompletion,
			sourceInlineCompletions,
		);
	}

	constructor(
		readonly filterText: string,
		readonly command: Command | undefined,
		readonly range: Range,
		readonly insertText: string,
		readonly snippetInfo: SnippetInfo | undefined,

		readonly additionalTextEdits: readonly ISingleEditOperation[],

		readonly sourceProvider: InlineCompletionsProvider,

		/**
		 * A reference to the original inline completion this inline completion has been constructed from.
		 * Used for event data to ensure referential equality.
		*/
		readonly sourceInlineCompletion: InlineCompletion,

		/**
		 * A reference to the original inline completion list this inline completion has been constructed from.
		 * Used for event data to ensure referential equality.
		*/
		readonly sourceInlineCompletions: InlineCompletions,
	) { }

	public hash(): string {
		return JSON.stringify({ insertText: this.insertText, range: this.range.toString() });
	}
}

interface SnippetInfo {
	snippet: string;
	/* Could be different than the main range */
	range: Range;
}

function getDefaultRange(position: Position, model: ITextModel): Range {
	const word = model.getWordAtPosition(position);
	const maxColumn = model.getLineMaxColumn(position.lineNumber);
	// By default, always replace up until the end of the current line.
	// This default might be subject to change!
	return word
		? new Range(position.lineNumber, word.startColumn, position.lineNumber, maxColumn)
		: Range.fromPositions(position, position.with(undefined, maxColumn));
}

function closeBrackets(text: string, position: Position, model: ITextModel, languageConfigurationService: ILanguageConfigurationService): string {
	const lineStart = model.getLineContent(position.lineNumber).substring(0, position.column - 1);
	const newLine = lineStart + text;

	const newTokens = model.tokenization.tokenizeLineWithEdit(position, newLine.length - (position.column - 1), text);
	const slicedTokens = newTokens?.sliceAndInflate(position.column - 1, newLine.length, 0);
	if (!slicedTokens) {
		return text;
	}

	const newText = fixBracketsInLine(slicedTokens, languageConfigurationService);

	return newText;
}
