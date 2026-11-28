import { z } from 'zod';

import {
	MCP_SERVER_TOOL_INPUTS_MAX_COUNT,
	mcpServerToolDescriptionSchema,
	mcpServerToolInputSettingsSchema,
	mcpServerToolNameSchema,
} from '../../schemas/mcp-server.schema';
import { Z } from '../../zod-class';

/** The name of a trigger input, as the trigger "When Executed by Another Workflow" declares it. */
export const mcpServerToolInputNameSchema = z.string().min(1).max(256);

/**
 * `inputs` sets the settings of the given trigger inputs, by input name. Inputs that are not in
 * the map keep their settings. The server ignores names that the trigger does not declare.
 */
export class UpdateMcpServerToolDto extends Z.class(
	{
		toolName: mcpServerToolNameSchema.optional(),
		description: mcpServerToolDescriptionSchema.optional(),
		inputs: z
			.record(mcpServerToolInputNameSchema, mcpServerToolInputSettingsSchema)
			.refine((inputs) => Object.keys(inputs).length <= MCP_SERVER_TOOL_INPUTS_MAX_COUNT, {
				message: `Send at most ${MCP_SERVER_TOOL_INPUTS_MAX_COUNT} inputs.`,
			})
			.optional(),
	},
	{ strict: true },
) {}
