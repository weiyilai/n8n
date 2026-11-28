import { AddMcpServerToolsDto } from '../add-mcp-server-tools.dto';
import { BlockMcpServerUserDto } from '../block-mcp-server-user.dto';
import { CreateMcpServerDto } from '../create-mcp-server.dto';
import { DraftMcpServerToolDto } from '../draft-mcp-server-tool.dto';
import { UpdateMcpServerToolDto } from '../update-mcp-server-tool.dto';
import { UpdateMcpServerDto } from '../update-mcp-server.dto';

describe('MCP server DTOs', () => {
	it('trims the name and the slug, and gives an empty description by default', () => {
		expect(CreateMcpServerDto.parse({ name: ' Sales tools ', slug: ' sales-tools ' })).toEqual({
			name: 'Sales tools',
			slug: 'sales-tools',
			description: '',
		});
	});

	it.each([
		'',
		'Sales-Tools',
		'-sales',
		'sales-',
		'sales--tools',
		'sales_tools',
		'../x',
		'a'.repeat(65),
	])('rejects the slug %j', (slug) => {
		expect(CreateMcpServerDto.safeParse({ name: 'Sales tools', slug }).success).toBe(false);
	});

	it('does not accept a slug in an update, because a slug never changes', () => {
		expect(UpdateMcpServerDto.safeParse({ name: 'New name' }).success).toBe(true);
		expect(UpdateMcpServerDto.safeParse({ slug: 'new-slug' }).success).toBe(false);
	});

	it.each(['get_pipeline_summary', 'tool2', 'a'.repeat(64)])(
		'accepts the tool name %j',
		(toolName) => {
			expect(UpdateMcpServerToolDto.safeParse({ toolName }).success).toBe(true);
		},
	);

	it.each(['', 'Get_Summary', 'get-summary', 'get summary', 'a'.repeat(65)])(
		'rejects the tool name %j',
		(toolName) => {
			expect(UpdateMcpServerToolDto.safeParse({ toolName }).success).toBe(false);
		},
	);

	it('adds tools from at least one workflow', () => {
		expect(AddMcpServerToolsDto.safeParse({ workflowIds: ['wf-1', 'wf-2'] }).success).toBe(true);
		expect(AddMcpServerToolsDto.safeParse({ workflowIds: [] }).success).toBe(false);
		expect(AddMcpServerToolsDto.safeParse({ workflowIds: ['w'.repeat(37)] }).success).toBe(false);
	});

	it('adds tools from at most 100 workflows, each with an id', () => {
		const ids = (count: number) => Array.from({ length: count }, (_, i) => `wf-${i}`);

		expect(AddMcpServerToolsDto.safeParse({ workflowIds: ids(100) }).success).toBe(true);
		expect(AddMcpServerToolsDto.safeParse({ workflowIds: ids(101) }).success).toBe(false);
		expect(AddMcpServerToolsDto.safeParse({ workflowIds: [''] }).success).toBe(false);
	});

	it('accepts a server description of at most 2000 characters', () => {
		expect(
			CreateMcpServerDto.safeParse({
				name: 'Sales tools',
				slug: 'sales-tools',
				description: 'a'.repeat(2000),
			}).success,
		).toBe(true);
		expect(
			CreateMcpServerDto.safeParse({
				name: 'Sales tools',
				slug: 'sales-tools',
				description: 'a'.repeat(2001),
			}).success,
		).toBe(false);
		expect(UpdateMcpServerDto.safeParse({ description: 'a'.repeat(2000) }).success).toBe(true);
		expect(UpdateMcpServerDto.safeParse({ description: 'a'.repeat(2001) }).success).toBe(false);
	});

	it('accepts a tool description of at most 2000 characters', () => {
		expect(UpdateMcpServerToolDto.safeParse({ description: 'a'.repeat(2000) }).success).toBe(true);
		expect(UpdateMcpServerToolDto.safeParse({ description: 'a'.repeat(2001) }).success).toBe(false);
	});

	it('drafts both fields, or one field for a "Generate" button', () => {
		expect(DraftMcpServerToolDto.parse({})).toEqual({});
		expect(DraftMcpServerToolDto.parse({ field: 'description' })).toEqual({ field: 'description' });
		expect(DraftMcpServerToolDto.parse({ field: 'toolName', persist: false })).toEqual({
			field: 'toolName',
			persist: false,
		});
		expect(DraftMcpServerToolDto.safeParse({ field: 'kind' }).success).toBe(false);
		expect(DraftMcpServerToolDto.safeParse({ persist: 'no' }).success).toBe(false);
	});

	it('drafts the description of one input only with its name', () => {
		expect(
			DraftMcpServerToolDto.parse({
				field: 'inputDescription',
				inputName: 'campaign_id',
				persist: false,
			}),
		).toEqual({ field: 'inputDescription', inputName: 'campaign_id', persist: false });
		expect(DraftMcpServerToolDto.safeParse({ field: 'inputDescription' }).success).toBe(false);
		expect(
			DraftMcpServerToolDto.safeParse({ field: 'inputDescription', inputName: '' }).success,
		).toBe(false);
		expect(DraftMcpServerToolDto.safeParse({ inputName: 'campaign_id' }).success).toBe(false);
		expect(
			DraftMcpServerToolDto.safeParse({ field: 'description', inputName: 'campaign_id' }).success,
		).toBe(false);
		expect(DraftMcpServerToolDto.safeParse({ extra: true }).success).toBe(false);
	});

	it('sets the description and the "Required" setting of trigger inputs', () => {
		expect(
			UpdateMcpServerToolDto.parse({
				inputs: { campaign_id: { description: '  The ID of the campaign. ', required: true } },
			}),
		).toEqual({
			inputs: { campaign_id: { description: 'The ID of the campaign.', required: true } },
		});
		expect(
			UpdateMcpServerToolDto.safeParse({ inputs: { campaign_id: { description: 'x' } } }).success,
		).toBe(false);
		expect(
			UpdateMcpServerToolDto.safeParse({
				inputs: { campaign_id: { description: 'a'.repeat(1001), required: false } },
			}).success,
		).toBe(false);
		expect(
			UpdateMcpServerToolDto.safeParse({
				inputs: { campaign_id: { description: 'a'.repeat(1000), required: false } },
			}).success,
		).toBe(true);
		expect(
			UpdateMcpServerToolDto.safeParse({ inputs: { '': { description: '', required: false } } })
				.success,
		).toBe(false);
	});

	it('takes at most 200 input settings in one update', () => {
		const inputs = (count: number) =>
			Object.fromEntries(
				Array.from({ length: count }, (_, i) => [
					`input_${i}`,
					{ description: '', required: false },
				]),
			);

		expect(UpdateMcpServerToolDto.safeParse({ inputs: inputs(200) }).success).toBe(true);
		expect(UpdateMcpServerToolDto.safeParse({ inputs: inputs(201) }).success).toBe(false);
	});

	it('blocks a person by user id', () => {
		const userId = '0190a8d6-4a2e-7000-8000-0000000000d1';
		expect(BlockMcpServerUserDto.safeParse({ userId }).success).toBe(true);
		expect(BlockMcpServerUserDto.safeParse({ userId: 'someone' }).success).toBe(false);
	});
});
