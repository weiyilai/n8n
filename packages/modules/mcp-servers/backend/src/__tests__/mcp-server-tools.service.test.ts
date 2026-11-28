import type { Logger } from '@n8n/backend-common';
import type { EventService } from '@n8n/backend-services';
import type { User } from '@n8n/db';
import { BadRequestError, ConflictError } from '@n8n/errors';
import { mock } from 'vitest-mock-extended';

import type { McpServerTool } from '../database/entities/mcp-server-tool.entity';
import type { McpServerToolRepository } from '../database/repositories/mcp-server-tool.repository';
import { McpServerToolsService } from '../services/mcp-server-tools.service';
import type { McpServer } from '../database/entities/mcp-server.entity';
import type { McpServerRepository } from '../database/repositories/mcp-server.repository';
import { McpServerToolNameTakenError } from '../errors/mcp-server-tool-name-taken.error';
import { McpServerToolNotFoundError } from '../errors/mcp-server-tool-not-found.error';
import type { WorkflowToolListItem } from '../ports/workflow-tool.port';
import { mockMcpServerPorts } from './test-utils/ports';

const PROJECT_ID = 'project-1';
const SERVER_ID = '7b0c2a52-3c1f-4f53-9a51-0c0d8c3a0a01';

function workflow(workflowId: string, name: string, description: string | null = null) {
	return { workflowId, name, description } satisfies WorkflowToolListItem;
}

function setup(workflows: WorkflowToolListItem[], unusable: string[] = [], added: string[] = []) {
	const servers = mock<McpServerRepository>();
	const tools = mock<McpServerToolRepository>();
	const { workflows: ports, textDrafts } = mockMcpServerPorts();
	servers.findInProject.mockResolvedValue(mock<McpServer>({ id: SERVER_ID }));
	tools.listByServer.mockResolvedValue(
		added.map((targetId) => mock<McpServerTool>({ targetId, kind: 'workflow' })),
	);
	ports.list.mockResolvedValue(workflows);
	ports.check.mockImplementation(async (_projectId, workflowId) =>
		unusable.includes(workflowId)
			? { callable: false, reason: 'not_published' }
			: { callable: true },
	);
	const service = new McpServerToolsService(
		servers,
		tools,
		ports,
		textDrafts,
		mock<EventService>(),
		mock<Logger>(),
	);
	return { service, ports };
}

describe('McpServerToolsService.findCandidates', () => {
	const many = Array.from({ length: 40 }, (_, i) =>
		workflow(`workflow-${i}`, `Workflow ${String(i).padStart(2, '0')}`),
	);

	it('checks only the workflows that it needs to fill the page', async () => {
		const { service, ports } = setup(many);

		const page = await service.findCandidates(PROJECT_ID, SERVER_ID, { limit: 5 });

		expect(page.candidates.map(({ name }) => name)).toEqual([
			'Workflow 00',
			'Workflow 01',
			'Workflow 02',
			'Workflow 03',
			'Workflow 04',
		]);
		expect(page).toMatchObject({ unusable: 0, more: true });
		// One batch of 10 is enough for 5 rows and the proof of a sixth.
		expect(ports.check).toHaveBeenCalledTimes(10);
	});

	it('leaves out the workflows that cannot be a tool or are already tools, and counts only the first', async () => {
		const { service } = setup(
			[workflow('a', 'Alpha'), workflow('b', 'Bravo'), workflow('c', 'Charlie')],
			['b'],
			['c'],
		);

		const page = await service.findCandidates(PROJECT_ID, SERVER_ID, { limit: 10 });

		expect(page.candidates).toEqual([
			{ workflowId: 'a', name: 'Alpha', description: null, reason: null },
		]);
		expect(page).toMatchObject({ unusable: 1, more: false });
	});

	it('leaves out a tool whose workflow the project no longer owns', async () => {
		const { service, ports } = setup([workflow('a', 'Alpha')], [], ['a']);
		ports.check.mockResolvedValue({ callable: false, reason: 'not_found' });

		const page = await service.findCandidates(PROJECT_ID, SERVER_ID, {
			limit: 10,
			includeUnusable: true,
		});

		expect(page.candidates).toEqual([]);
	});

	it('stops after 200 checks and says that more workflows exist', async () => {
		const unpublished = Array.from({ length: 500 }, (_, i) =>
			workflow(`w-${i}`, `Workflow ${String(i).padStart(3, '0')}`),
		);
		const { service, ports } = setup(
			unpublished,
			unpublished.map(({ workflowId }) => workflowId),
		);

		const page = await service.findCandidates(PROJECT_ID, SERVER_ID, { limit: 1 });

		expect(ports.check).toHaveBeenCalledTimes(200);
		expect(page).toMatchObject({ candidates: [], unusable: 200, more: true });
	});

	it('lists the workflows that cannot be a tool, with the reason, on request', async () => {
		const { service } = setup([workflow('a', 'Alpha'), workflow('b', 'Bravo')], ['b']);

		const page = await service.findCandidates(PROJECT_ID, SERVER_ID, {
			limit: 10,
			includeUnusable: true,
		});

		expect(page.candidates).toEqual([
			expect.objectContaining({ workflowId: 'a', reason: null }),
			expect.objectContaining({ workflowId: 'b', reason: 'not_published' }),
		]);
		expect(page.unusable).toBe(0);
	});

	it('matches the query on the name or the description, in any case', async () => {
		const { service, ports } = setup([
			workflow('a', 'Lead score'),
			workflow('b', 'Invoice', 'Scores the LEADS of a campaign'),
			workflow('c', 'Ticket history'),
		]);

		const page = await service.findCandidates(PROJECT_ID, SERVER_ID, {
			query: 'lead',
			limit: 10,
		});

		expect(page.candidates.map(({ workflowId }) => workflowId)).toEqual(['b', 'a']);
		expect(ports.check).toHaveBeenCalledTimes(2);
	});
});

describe('McpServerToolsService reads for an approval card', () => {
	it('reads the names of the given workflows, with no check', async () => {
		const { service, ports } = setup([workflow('a', 'Alpha')]);

		await expect(service.workflowNames(PROJECT_ID, ['a'])).resolves.toEqual([
			{ workflowId: 'a', name: 'Alpha' },
		]);
		expect(ports.list).toHaveBeenCalledWith(PROJECT_ID, ['a']);
		expect(ports.check).not.toHaveBeenCalled();
	});
});

describe('McpServerToolsService.listTools', () => {
	it('reports a moved workflow tool as broken with reason moved', async () => {
		const servers = mock<McpServerRepository>();
		const tools = mock<McpServerToolRepository>();
		const { workflows, textDrafts } = mockMcpServerPorts();
		const now = new Date();
		servers.findInProject.mockResolvedValue(mock<McpServer>({ id: SERVER_ID }));
		tools.listByServer.mockResolvedValue([
			mock<McpServerTool>({
				id: '7b0c2a52-3c1f-4f53-9a51-0c0d8c3a0a04',
				serverId: SERVER_ID,
				kind: 'workflow',
				targetId: 'workflow-moved',
				toolName: 'moved_tool',
				description: 'Moved workflow',
				draftSource: 'edited',
				position: 0,
				createdAt: now,
				updatedAt: now,
			}),
		]);
		workflows.check.mockResolvedValue({ callable: false, reason: 'moved' });
		const service = new McpServerToolsService(
			servers,
			tools,
			workflows,
			textDrafts,
			mock<EventService>(),
			mock<Logger>(),
		);

		const result = await service.listTools(PROJECT_ID, SERVER_ID);

		expect(result).toEqual([
			expect.objectContaining({ toolName: 'moved_tool', brokenReason: 'moved' }),
		]);
	});
});

describe('McpServerToolsService.updateTool', () => {
	const TOOL_ID = '7b0c2a52-3c1f-4f53-9a51-0c0d8c3a0a02';

	function setupTool() {
		const servers = mock<McpServerRepository>();
		const tools = mock<McpServerToolRepository>();
		const tool = mock<McpServerTool>({
			id: TOOL_ID,
			serverId: SERVER_ID,
			kind: 'workflow',
			targetId: 'workflow-1',
			toolData: { inputs: { days: { description: 'How many days.', required: false } } },
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		servers.findInProject.mockResolvedValue(mock<McpServer>({ id: SERVER_ID }));
		tools.findInServer.mockResolvedValue(tool);
		tools.updateInServer.mockResolvedValue(tool);
		const { workflows, textDrafts } = mockMcpServerPorts();
		workflows.check.mockResolvedValue({ callable: true });
		workflows.listInputs.mockResolvedValue([
			{ name: 'campaign_id', type: 'string' },
			{ name: 'days', type: 'number' },
		]);
		const service = new McpServerToolsService(
			servers,
			tools,
			workflows,
			textDrafts,
			mock<EventService>(),
			mock<Logger>(),
		);
		return { service, tools, workflows };
	}

	it('marks an edit of the builder as edited', async () => {
		const { service, tools } = setupTool();

		await service.updateTool(PROJECT_ID, SERVER_ID, TOOL_ID, { description: 'New' });

		expect(tools.updateInServer).toHaveBeenCalledWith(SERVER_ID, TOOL_ID, {
			description: 'New',
			draftSource: 'edited',
		});
	});

	it('keeps the draft source that the caller gives, such as ai for the Assistant', async () => {
		const { service, tools } = setupTool();

		await service.updateTool(PROJECT_ID, SERVER_ID, TOOL_ID, { description: 'New' }, 'ai');

		expect(tools.updateInServer).toHaveBeenCalledWith(SERVER_ID, TOOL_ID, {
			description: 'New',
			draftSource: 'ai',
		});
	});

	it('stores the settings of trigger inputs, keeps the other inputs, and ignores unknown names', async () => {
		const { service, tools, workflows } = setupTool();

		await service.updateTool(PROJECT_ID, SERVER_ID, TOOL_ID, {
			inputs: {
				campaign_id: { description: 'The ID of the campaign.', required: true },
				unknown_input: { description: 'Not in the trigger.', required: true },
			},
		});

		expect(workflows.listInputs).toHaveBeenCalledWith(PROJECT_ID, 'workflow-1');
		// A change of only the input settings is not a change of the tool text.
		expect(tools.updateInServer).toHaveBeenCalledWith(SERVER_ID, TOOL_ID, {
			toolData: {
				inputs: {
					days: { description: 'How many days.', required: false },
					campaign_id: { description: 'The ID of the campaign.', required: true },
				},
			},
		});
	});

	it('saves nothing when every input name is unknown', async () => {
		const { service, tools } = setupTool();

		await service.updateTool(PROJECT_ID, SERVER_ID, TOOL_ID, {
			inputs: { unknown_input: { description: 'Not in the trigger.', required: true } },
		});

		expect(tools.updateInServer).not.toHaveBeenCalled();
	});

	it('saves the text and the input settings in one update', async () => {
		const { service, tools } = setupTool();

		await service.updateTool(PROJECT_ID, SERVER_ID, TOOL_ID, {
			description: 'New',
			inputs: { days: { description: 'The number of days.', required: true } },
		});

		expect(tools.updateInServer).toHaveBeenCalledTimes(1);
		expect(tools.updateInServer).toHaveBeenCalledWith(SERVER_ID, TOOL_ID, {
			description: 'New',
			draftSource: 'edited',
			toolData: { inputs: { days: { description: 'The number of days.', required: true } } },
		});
	});
});

describe('McpServerToolsService.draftTool saves a drafted name', () => {
	const TOOL_ID = '7b0c2a52-3c1f-4f53-9a51-0c0d8c3a0a03';
	const ACTOR = { userId: 'user-1', source: 'ui' } as const;

	function setupDraft(toolData: McpServerTool['toolData'] = null) {
		const servers = mock<McpServerRepository>();
		const tools = mock<McpServerToolRepository>();
		const { workflows, textDrafts } = mockMcpServerPorts();
		const tool = mock<McpServerTool>({
			id: TOOL_ID,
			serverId: SERVER_ID,
			kind: 'workflow',
			targetId: 'workflow-1',
			toolName: 'old_name',
			description: 'Old text.',
			toolData,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		servers.findInProject.mockResolvedValue(mock<McpServer>({ id: SERVER_ID }));
		tools.findInServer.mockResolvedValue(tool);
		tools.listByServer.mockResolvedValue([]);
		textDrafts.isAvailable.mockResolvedValue(true);
		textDrafts.draft.mockResolvedValue({
			status: 'drafted',
			text: JSON.stringify({ toolName: 'get_campaign', description: 'Returns one campaign.' }),
		});
		workflows.describe.mockResolvedValue({
			callable: true,
			name: 'Campaign',
			description: null,
			inputSchema: { type: 'object', additionalProperties: true },
			nodeNames: [],
		});
		const service = new McpServerToolsService(
			servers,
			tools,
			workflows,
			textDrafts,
			mock<EventService>(),
			mock<Logger>(),
		);
		const draft = async () =>
			await service.draftTool(mock<User>(), PROJECT_ID, SERVER_ID, TOOL_ID, ACTOR);
		return { draft, tools, tool, service, textDrafts, workflows };
	}

	const INPUT_SCHEMA = {
		type: 'object' as const,
		properties: {
			campaign_id: { type: ['string', 'null'] },
			days: { type: ['number', 'null'] },
		},
		additionalProperties: false,
	};

	it('saves the drafted input descriptions, without overwriting a description of the builder', async () => {
		const { draft, tools, tool, textDrafts, workflows } = setupDraft({
			inputs: { days: { description: 'Days of the builder.', required: true } },
		});
		tools.updateInServer.mockResolvedValue(tool);
		workflows.describe.mockResolvedValue({
			callable: true,
			name: 'Campaign',
			description: null,
			inputSchema: INPUT_SCHEMA,
			nodeNames: [],
		});
		textDrafts.draft.mockResolvedValue({
			status: 'drafted',
			text: JSON.stringify({
				toolName: 'get_campaign',
				description: 'Returns one campaign.',
				inputDescriptions: { campaign_id: 'The ID of the campaign.', days: 'The days.' },
			}),
		});

		const result = await draft();

		expect(result).toMatchObject({
			status: 'drafted',
			inputDescriptions: { campaign_id: 'The ID of the campaign.', days: 'The days.' },
		});
		expect(tools.updateInServer).toHaveBeenCalledWith(SERVER_ID, TOOL_ID, {
			toolName: 'get_campaign',
			description: 'Returns one campaign.',
			draftSource: 'ai',
			toolData: {
				inputs: {
					days: { description: 'Days of the builder.', required: true },
					campaign_id: { description: 'The ID of the campaign.', required: false },
				},
			},
		});
	});

	it('saves the name and the description when the input descriptions are broken', async () => {
		const { draft, tools, tool, textDrafts, workflows } = setupDraft();
		tools.updateInServer.mockResolvedValue(tool);
		workflows.describe.mockResolvedValue({
			callable: true,
			name: 'Campaign',
			description: null,
			inputSchema: INPUT_SCHEMA,
			nodeNames: [],
		});
		textDrafts.draft.mockResolvedValue({
			status: 'drafted',
			text: JSON.stringify({
				toolName: 'get_campaign',
				description: 'Returns one campaign.',
				inputDescriptions: 'broken',
			}),
		});

		await expect(draft()).resolves.toMatchObject({ status: 'drafted', inputDescriptions: {} });
		expect(tools.updateInServer).toHaveBeenCalledWith(SERVER_ID, TOOL_ID, {
			toolName: 'get_campaign',
			description: 'Returns one campaign.',
			draftSource: 'ai',
		});
	});

	it('drafts the description of one input without saving it when persist is false', async () => {
		const { service, tools, textDrafts, workflows } = setupDraft({
			inputs: { days: { description: 'Old days.', required: true } },
		});
		workflows.describe.mockResolvedValue({
			callable: true,
			name: 'Campaign',
			description: null,
			inputSchema: INPUT_SCHEMA,
			nodeNames: [],
		});
		textDrafts.draft.mockResolvedValue({
			status: 'drafted',
			text: JSON.stringify({ inputDescription: 'The number of days, from 1 to 90.' }),
		});

		const result = await service.draftTool(
			mock<User>(),
			PROJECT_ID,
			SERVER_ID,
			TOOL_ID,
			ACTOR,
			'inputDescription',
			{ persist: false, inputName: 'days' },
		);

		expect(textDrafts.draft.mock.calls[0][1]).toContain(
			'The current description of the input "days": Old days.',
		);
		expect(result).toMatchObject({
			status: 'drafted',
			tool: { toolName: 'old_name', description: 'Old text.' },
			inputDescriptions: { days: 'The number of days, from 1 to 90.' },
		});
		expect(tools.updateInServer).not.toHaveBeenCalled();
	});

	it.each([['unknown_input'], [undefined]])(
		'refuses to draft the description of the input %s that the trigger does not declare',
		async (inputName) => {
			const { service, textDrafts, workflows } = setupDraft();
			workflows.describe.mockResolvedValue({
				callable: true,
				name: 'Campaign',
				description: null,
				inputSchema: INPUT_SCHEMA,
				nodeNames: [],
			});

			await expect(
				service.draftTool(mock<User>(), PROJECT_ID, SERVER_ID, TOOL_ID, ACTOR, 'inputDescription', {
					persist: false,
					inputName,
				}),
			).rejects.toBeInstanceOf(BadRequestError);
			expect(textDrafts.draft).not.toHaveBeenCalled();
		},
	);

	it('tries again when another draft took the name first', async () => {
		const { draft, tools, tool } = setupDraft();
		const competing = mock<McpServerTool>({ id: 'other-tool', toolName: 'get_campaign' });
		tools.listByServer.mockResolvedValueOnce([]).mockResolvedValueOnce([tool, competing]);
		tools.updateInServer
			.mockRejectedValueOnce(new McpServerToolNameTakenError())
			.mockResolvedValueOnce(tool);

		await expect(draft()).resolves.toMatchObject({ status: 'drafted' });
		expect(tools.updateInServer).toHaveBeenCalledTimes(2);
		expect(tools.updateInServer).toHaveBeenNthCalledWith(
			1,
			SERVER_ID,
			TOOL_ID,
			expect.objectContaining({ toolName: 'get_campaign' }),
		);
		expect(tools.updateInServer).toHaveBeenNthCalledWith(
			2,
			SERVER_ID,
			TOOL_ID,
			expect.objectContaining({ toolName: 'get_campaign_2' }),
		);
	});

	it('does not try again on another conflict', async () => {
		const { draft, tools } = setupDraft();
		const conflict = new ConflictError('Another conflict');
		tools.updateInServer.mockRejectedValue(conflict);

		await expect(draft()).rejects.toBe(conflict);
		expect(tools.updateInServer).toHaveBeenCalledTimes(1);
	});

	it('stops after 10 tries when the name is taken each time', async () => {
		const { draft, tools } = setupDraft();
		tools.updateInServer.mockRejectedValue(new McpServerToolNameTakenError());

		await expect(draft()).rejects.toBeInstanceOf(McpServerToolNameTakenError);
		expect(tools.updateInServer).toHaveBeenCalledTimes(10);
	});

	it('gives a 404 when the tool is gone at save time', async () => {
		const { draft, tools } = setupDraft();
		tools.updateInServer.mockResolvedValue(null);

		await expect(draft()).rejects.toBeInstanceOf(McpServerToolNotFoundError);
		expect(tools.updateInServer).toHaveBeenCalledTimes(1);
	});

	it('returns a collision-free draft without saving when persist is false', async () => {
		const servers = mock<McpServerRepository>();
		const tools = mock<McpServerToolRepository>();
		const { workflows, textDrafts } = mockMcpServerPorts();
		const tool = mock<McpServerTool>({
			id: TOOL_ID,
			serverId: SERVER_ID,
			kind: 'workflow',
			targetId: 'workflow-1',
			toolName: 'old_name',
			description: 'Old text.',
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		const competing = mock<McpServerTool>({ id: 'other-tool', toolName: 'get_campaign' });
		servers.findInProject.mockResolvedValue(mock<McpServer>({ id: SERVER_ID }));
		tools.findInServer.mockResolvedValue(tool);
		tools.listByServer.mockResolvedValue([tool, competing]);
		textDrafts.isAvailable.mockResolvedValue(true);
		textDrafts.draft.mockResolvedValue({
			status: 'drafted',
			text: JSON.stringify({ toolName: 'get_campaign' }),
		});
		workflows.describe.mockResolvedValue({
			callable: true,
			name: 'Campaign',
			description: null,
			inputSchema: { type: 'object', additionalProperties: true },
			nodeNames: [],
		});
		const service = new McpServerToolsService(
			servers,
			tools,
			workflows,
			textDrafts,
			mock<EventService>(),
			mock<Logger>(),
		);

		const result = await service.draftTool(
			mock<User>(),
			PROJECT_ID,
			SERVER_ID,
			TOOL_ID,
			ACTOR,
			'toolName',
			{ persist: false },
		);

		expect(result).toMatchObject({
			status: 'drafted',
			tool: { toolName: 'get_campaign_2', description: 'Old text.' },
		});
		expect(tools.updateInServer).not.toHaveBeenCalled();
	});
});

describe('McpServerToolsService.getToolDetail', () => {
	const TOOL_ID = '7b0c2a52-3c1f-4f53-9a51-0c0d8c3a0a05';

	it('returns source name, inputs, outputs, and broken reason for a workflow tool', async () => {
		const servers = mock<McpServerRepository>();
		const tools = mock<McpServerToolRepository>();
		const { workflows, textDrafts } = mockMcpServerPorts();
		const user = mock<User>();
		const now = new Date();
		servers.findInProject.mockResolvedValue(mock<McpServer>({ id: SERVER_ID }));
		tools.findInServer.mockResolvedValue(
			mock<McpServerTool>({
				id: TOOL_ID,
				serverId: SERVER_ID,
				kind: 'workflow',
				targetId: 'workflow-1',
				toolName: 'get_campaign_numbers',
				description: 'Campaign numbers.',
				draftSource: 'edited',
				toolData: {
					inputs: {
						campaign_id: { description: 'The ID of the campaign.', required: true },
						removed_input: { description: 'Gone.', required: true },
					},
				},
				position: 0,
				createdAt: now,
				updatedAt: now,
			}),
		);
		workflows.check.mockResolvedValue({ callable: true });
		workflows.inspect.mockResolvedValue({
			sourceName: 'Get campaign numbers',
			inputs: [{ name: 'campaign_id', type: 'string' }],
			outputs: [
				{ name: 'clicks', type: 'number' },
				{ name: 'active', type: 'boolean' },
			],
		});
		const service = new McpServerToolsService(
			servers,
			tools,
			workflows,
			textDrafts,
			mock<EventService>(),
			mock<Logger>(),
		);

		const detail = await service.getToolDetail(user, PROJECT_ID, SERVER_ID, TOOL_ID);

		expect(workflows.inspect).toHaveBeenCalledWith(PROJECT_ID, 'workflow-1', user);
		expect(detail).toMatchObject({
			id: TOOL_ID,
			toolName: 'get_campaign_numbers',
			brokenReason: null,
			sourceName: 'Get campaign numbers',
			outputs: [
				{ name: 'clicks', type: 'number' },
				{ name: 'active', type: 'boolean' },
			],
		});
		// The settings of an input that the trigger lost are not in the answer.
		expect(detail.inputs).toEqual([
			{
				name: 'campaign_id',
				type: 'string',
				description: 'The ID of the campaign.',
				required: true,
			},
		]);
	});

	it('returns empty inputs and null outputs for a non-workflow tool without calling workflows.inspect', async () => {
		const servers = mock<McpServerRepository>();
		const tools = mock<McpServerToolRepository>();
		const { workflows, textDrafts } = mockMcpServerPorts();
		const now = new Date();
		servers.findInProject.mockResolvedValue(mock<McpServer>({ id: SERVER_ID }));
		tools.findInServer.mockResolvedValue(
			mock<McpServerTool>({
				id: TOOL_ID,
				serverId: SERVER_ID,
				kind: 'node',
				targetId: null,
				toolName: 'slack_send',
				description: 'Send a Slack message.',
				draftSource: 'defaults',
				position: 0,
				createdAt: now,
				updatedAt: now,
			}),
		);
		const service = new McpServerToolsService(
			servers,
			tools,
			workflows,
			textDrafts,
			mock<EventService>(),
			mock<Logger>(),
		);

		const detail = await service.getToolDetail(mock<User>(), PROJECT_ID, SERVER_ID, TOOL_ID);

		expect(workflows.inspect).not.toHaveBeenCalled();
		expect(detail).toMatchObject({
			id: TOOL_ID,
			kind: 'node',
			brokenReason: null,
			sourceName: null,
			inputs: [],
			outputs: null,
		});
	});
});
