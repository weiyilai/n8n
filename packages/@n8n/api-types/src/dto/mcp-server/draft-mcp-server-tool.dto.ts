import { z } from 'zod';

import { mcpServerToolDraftFieldSchema } from '../../schemas/mcp-server.schema';
import { mcpServerToolInputNameSchema } from './update-mcp-server-tool.dto';

/**
 * Without `field`, the draft writes the name, the description, and the description of each input,
 * as after an add. `field: 'inputDescription'` needs `inputName`, the input to write. Set
 * `persist: false` to return a draft without saving it.
 */
const draftMcpServerToolSchema = z
	.object({
		field: mcpServerToolDraftFieldSchema.optional(),
		inputName: mcpServerToolInputNameSchema.optional(),
		persist: z.boolean().optional(),
	})
	.strict()
	.refine(({ field, inputName }) => (field === 'inputDescription') === (inputName !== undefined), {
		message: 'Send `inputName` with `field: "inputDescription"`, and only with it.',
		path: ['inputName'],
	});

type DraftMcpServerTool = z.infer<typeof draftMcpServerToolSchema>;

export class DraftMcpServerToolDto implements DraftMcpServerTool {
	field?: DraftMcpServerTool['field'];

	inputName?: string;

	persist?: boolean;

	static schema = draftMcpServerToolSchema;

	constructor(data: DraftMcpServerTool) {
		Object.assign(this, draftMcpServerToolSchema.parse(data));
	}

	static safeParse(data: unknown) {
		return draftMcpServerToolSchema.safeParse(data);
	}

	static parse(data: unknown): DraftMcpServerTool {
		return draftMcpServerToolSchema.parse(data);
	}
}
