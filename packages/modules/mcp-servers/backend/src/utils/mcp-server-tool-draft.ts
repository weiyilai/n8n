import {
	MCP_SERVER_TOOL_INPUT_DESCRIPTION_MAX_LENGTH,
	mcpServerToolDescriptionSchema,
	mcpServerToolInputDescriptionSchema,
	mcpServerToolNameSchema,
	type McpServerToolDraftField,
} from '@n8n/api-types';
import { extractJsonCandidate } from '@n8n/ai-utilities/llm-output';
import { isRecord } from '@n8n/utils/is-record';

import type { WorkflowToolInputSchema } from './workflow-tool-input-schema';

/** What the model gets about the workflow of a tool. */
export interface ToolDraftSource {
	workflowName: string;
	workflowDescription: string | null;
	/** The inputs of the published version. The prompt names each input and its type. */
	inputSchema: WorkflowToolInputSchema;
	nodeNames: string[];
}

/**
 * "Generate" writes one field again. The model gets the current text, to write a new one. For
 * `inputDescription`, `input` names the input and gives its current description.
 */
export type ToolDraftRequest =
	| {
			field: Exclude<McpServerToolDraftField, 'inputDescription'>;
			current: { toolName: string; description: string };
	  }
	| {
			field: 'inputDescription';
			current: { toolName: string; description: string };
			input: { name: string; description: string };
	  };

const FIELD_JSON: Record<McpServerToolDraftField, string> = {
	toolName: '"toolName": "<tool name>"',
	description: '"description": "<description>"',
	inputDescription: '"inputDescription": "<input description>"',
};

const INPUT_DESCRIPTION_RULE =
	'one short sentence: what value to send, with its format. For example: "The first day of the range, as YYYY-MM-DD."';

/** Every input is optional, so the schema adds `null` to each type. The prompt leaves it out. */
function inputType(property: unknown): string {
	const type = isRecord(property) ? property.type : undefined;
	const types = (Array.isArray(type) ? type : [type]).filter(
		(item): item is string => typeof item === 'string' && item !== 'null',
	);
	return types.length > 0 ? types.join(' or ') : 'any';
}

function describeInputs(schema: WorkflowToolInputSchema): string {
	const inputs = Object.entries(schema.properties ?? {}).map(
		([name, property]) => `${name} (${inputType(property)})`,
	);
	return inputs.length > 0 ? inputs.join(', ') : 'none';
}

/** The names of the trigger inputs in the input schema. */
export function inputNamesOf(schema: WorkflowToolInputSchema): string[] {
	return Object.keys(schema.properties ?? {});
}

function inputDescriptionsJson(inputNames: string[]): string {
	return `"inputDescriptions": {${inputNames
		.map((name) => `${JSON.stringify(name)}: "<input description>"`)
		.join(', ')}}`;
}

/**
 * The prompt of one draft call. The model writes the name, the description, and the description
 * of each input that AI clients read to pick and call the tool, or only the field of a "Generate"
 * button.
 */
export function buildToolDraftPrompt(source: ToolDraftSource, request?: ToolDraftRequest): string {
	const fields: McpServerToolDraftField[] = request ? [request.field] : ['toolName', 'description'];
	// The first draft also writes a description for each input, when the trigger has inputs.
	const inputNames = request ? [] : inputNamesOf(source.inputSchema);
	const lines = [
		'You write the text of one tool of an MCP server. The tool runs an n8n workflow.',
		'AI clients read the tool name and the description to decide when to call the tool.',
		'AI clients read the description of each input to choose the value to send.',
		'',
		'The workflow:',
		`Workflow name: ${source.workflowName}`,
		`Workflow description: ${source.workflowDescription?.trim() || 'none'}`,
		`Inputs: ${describeInputs(source.inputSchema)}`,
		`Nodes: ${source.nodeNames.length > 0 ? source.nodeNames.join(', ') : 'none'}`,
		'',
		'Rules:',
	];
	if (fields.includes('toolName')) {
		lines.push(
			'- Tool name: lowercase letters, digits, and "_" only, at most 64 characters. Start with a verb, for example "get_campaign_numbers".',
		);
	}
	if (fields.includes('description')) {
		lines.push(
			'- Description: one to three short sentences. Say what the tool does, what it returns, and when to use it. Do not name n8n, the workflow, or the nodes.',
		);
	}
	if (inputNames.length > 0) {
		lines.push(`- Input descriptions: for each input, ${INPUT_DESCRIPTION_RULE}`);
	}
	if (request?.field === 'inputDescription') {
		lines.push(
			`- Input description: for the input "${request.input.name}" only, ${INPUT_DESCRIPTION_RULE}`,
		);
	}
	if (request) {
		lines.push(
			'',
			`The current tool name: ${request.current.toolName}`,
			`The current description: ${request.current.description || 'none'}`,
		);
		if (request.field === 'inputDescription') {
			lines.push(
				`The current description of the input "${request.input.name}": ${request.input.description || 'none'}`,
			);
		}
		lines.push(
			'The builder asked for another text, so the current text is not good enough.',
			'Write a new text for this field only. It must differ from the current text: use other words, for example another verb or a more specific noun.',
		);
	}
	const json = fields.map((field) => FIELD_JSON[field]);
	if (inputNames.length > 0) json.push(inputDescriptionsJson(inputNames));
	lines.push('', `Answer with one JSON object and nothing else: {${json.join(', ')}}`);
	return lines.join('\n');
}

/** The text that the model wrote. A draft of one field has only that field. */
export interface ToolDraft {
	toolName?: string;
	description?: string;
	/** The drafted description of each input, by input name. */
	inputDescriptions?: Record<string, string>;
}

export type ToolDraftAnswer = { ok: true; draft: ToolDraft } | { ok: false; error: string };

function parseJsonObject(answer: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(extractJsonCandidate(answer));
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function parseInputDescription(value: unknown): string | null {
	const description = mcpServerToolInputDescriptionSchema.safeParse(value);
	return description.success && description.data !== '' ? description.data : null;
}

/**
 * The input descriptions of the first draft. A missing or broken description is left out, so
 * that it does not fail the name and the description of the tool.
 */
function parseInputDescriptions(value: unknown, inputNames: string[]): Record<string, string> {
	if (!isRecord(value)) return {};
	const entries: Array<[string, string]> = [];
	for (const name of inputNames) {
		if (!Object.prototype.hasOwnProperty.call(value, name)) continue;
		const description = parseInputDescription(value[name]);
		if (description !== null) entries.push([name, description]);
	}
	return Object.fromEntries(entries);
}

/**
 * Applies the rules to the answer of the model. Without `field`, the name and the description
 * must follow the rules, and the input descriptions of `inputNames` that follow the rules are
 * kept. For `field: 'inputDescription'`, `inputNames` has the one input to write. A broken answer
 * gives an error, and the tool keeps its text.
 */
export function parseToolDraftAnswer(
	answer: string,
	field?: McpServerToolDraftField,
	inputNames: string[] = [],
): ToolDraftAnswer {
	const parsed = parseJsonObject(answer);
	if (!parsed) return { ok: false, error: 'The answer of the model is not a JSON object.' };

	if (field === 'inputDescription') {
		const [inputName] = inputNames;
		const description = parseInputDescription(parsed.inputDescription);
		if (inputName === undefined || description === null) {
			return {
				ok: false,
				error: `The input description of the draft breaks the rules: it must have text, at most ${MCP_SERVER_TOOL_INPUT_DESCRIPTION_MAX_LENGTH} characters.`,
			};
		}
		return { ok: true, draft: { inputDescriptions: { [inputName]: description } } };
	}

	const draft: ToolDraft = {};
	if (field !== 'description') {
		const toolName = mcpServerToolNameSchema.safeParse(parsed.toolName);
		if (!toolName.success) {
			return {
				ok: false,
				error:
					'The tool name of the draft breaks the rules: use lowercase letters, digits, and "_", at most 64 characters.',
			};
		}
		draft.toolName = toolName.data;
	}
	if (field !== 'toolName') {
		const description = mcpServerToolDescriptionSchema.safeParse(parsed.description);
		if (!description.success || description.data === '') {
			return {
				ok: false,
				error:
					'The description of the draft breaks the rules: it must have text, at most 2000 characters.',
			};
		}
		draft.description = description.data;
	}
	if (!field && inputNames.length > 0) {
		draft.inputDescriptions = parseInputDescriptions(parsed.inputDescriptions, inputNames);
	}
	return { ok: true, draft };
}
