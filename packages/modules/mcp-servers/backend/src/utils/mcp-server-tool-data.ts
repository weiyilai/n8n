import {
	mcpServerToolInputSettingsSchema,
	type McpServerToolField,
	type McpServerToolInputField,
	type McpServerToolInputSettings,
} from '@n8n/api-types';
import { isRecord } from '@n8n/utils/is-record';

import type { WorkflowToolInputSchema } from './workflow-tool-input-schema';

/** The settings of the trigger inputs of a workflow tool, by input name. */
export type InputSettings = Map<string, McpServerToolInputSettings>;

/** The shape that n8n writes to `toolData` of a workflow tool. */
export type WorkflowToolData = { inputs: Record<string, McpServerToolInputSettings> };

/** An input without stored settings. */
export const NO_INPUT_SETTINGS: McpServerToolInputSettings = { description: '', required: false };

/**
 * Reads the input settings from `toolData` of a workflow tool:
 * `{ inputs: { [inputName]: { description, required } } }`. An entry that does not have this shape
 * reads as no settings, so broken data never stops a tool.
 */
export function readInputSettings(toolData: unknown): InputSettings {
	const settings: InputSettings = new Map();
	if (!isRecord(toolData) || !isRecord(toolData.inputs)) return settings;
	for (const [name, value] of Object.entries(toolData.inputs)) {
		const parsed = mcpServerToolInputSettingsSchema.safeParse(value);
		if (parsed.success) settings.set(name, parsed.data);
	}
	return settings;
}

/** The new `toolData` with these input settings. */
export function writeInputSettings(settings: InputSettings): WorkflowToolData {
	return { inputs: Object.fromEntries(settings) };
}

/** The trigger inputs with their settings. Settings of inputs that the trigger lost are left out. */
export function withInputSettings(
	fields: McpServerToolField[],
	settings: InputSettings,
): McpServerToolInputField[] {
	return fields.map((field) => ({ ...field, ...(settings.get(field.name) ?? NO_INPUT_SETTINGS) }));
}

/** A required input has no `null` type, because a call must send a value. */
function withoutNullType(property: Record<string, unknown>): Record<string, unknown> {
	const { type, anyOf } = property;
	if (Array.isArray(type)) {
		const types = type.filter((item) => item !== 'null');
		if (types.length === 0 || types.length === type.length) return property;
		return { ...property, type: types.length === 1 ? types[0] : types };
	}
	if (Array.isArray(anyOf)) {
		const options = anyOf.filter((option) => !(isRecord(option) && option.type === 'null'));
		if (options.length === 0 || options.length === anyOf.length) return property;
		return { ...property, anyOf: options };
	}
	return property;
}

/**
 * Adds the input settings to the input schema that AI clients get: the description of each
 * input, and the required inputs. Settings of inputs that the schema does not have are ignored.
 */
export function applyInputSettings(
	schema: WorkflowToolInputSchema,
	settings: InputSettings,
): WorkflowToolInputSchema {
	if (!schema.properties || settings.size === 0) return schema;
	const required = new Set(schema.required ?? []);
	const properties = Object.fromEntries(
		Object.entries(schema.properties).map(([name, property]) => {
			const setting = settings.get(name);
			if (!setting) return [name, property];
			let next = isRecord(property) ? property : {};
			if (setting.description) next = { ...next, description: setting.description };
			if (setting.required) {
				required.add(name);
				next = withoutNullType(next);
			}
			return [name, next];
		}),
	);
	return {
		...schema,
		properties,
		...(required.size > 0 && { required: [...required] }),
	};
}

/** The required inputs that a call did not send, or sent as `null`. */
export function missingRequiredInputs(
	input: unknown,
	settings: InputSettings,
	inputNames: string[],
): string[] {
	const values = isRecord(input) ? input : {};
	return inputNames.filter(
		(name) =>
			settings.get(name)?.required === true &&
			(!Object.prototype.hasOwnProperty.call(values, name) ||
				values[name] === null ||
				values[name] === undefined),
	);
}
