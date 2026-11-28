import type { WorkflowToolInputSchema } from '../utils/workflow-tool-input-schema';
import {
	applyInputSettings,
	missingRequiredInputs,
	readInputSettings,
	withInputSettings,
	writeInputSettings,
} from '../utils/mcp-server-tool-data';

const SCHEMA: WorkflowToolInputSchema = {
	type: 'object',
	properties: {
		campaign_id: { description: 'campaign_id', type: ['string', 'null'] },
		days: { description: 'days', anyOf: [{ type: 'number' }, { type: 'null' }] },
		filters: { description: 'filters' },
	},
	additionalProperties: false,
};

describe('readInputSettings', () => {
	it.each([
		['null', null],
		['a text', 'broken'],
		['a list', [1, 2]],
		['no inputs', { other: true }],
		['inputs as a list', { inputs: ['campaign_id'] }],
	])('reads %s as no settings', (_case, toolData) => {
		expect(readInputSettings(toolData).size).toBe(0);
	});

	it('keeps the entries that have the right shape, and drops the others', () => {
		const settings = readInputSettings({
			inputs: {
				campaign_id: { description: 'The ID.', required: true },
				days: { description: 'Days.' },
				filters: 'broken',
			},
		});

		expect([...settings]).toEqual([['campaign_id', { description: 'The ID.', required: true }]]);
	});

	it('writes what it reads', () => {
		const toolData = writeInputSettings(
			new Map([['campaign_id', { description: 'The ID.', required: true }]]),
		);

		expect(toolData).toEqual({
			inputs: { campaign_id: { description: 'The ID.', required: true } },
		});
		expect([...readInputSettings(toolData)]).toEqual([
			['campaign_id', { description: 'The ID.', required: true }],
		]);
	});
});

describe('withInputSettings', () => {
	it('adds the settings to the trigger inputs, and leaves out settings of lost inputs', () => {
		const settings = readInputSettings({
			inputs: {
				campaign_id: { description: 'The ID.', required: true },
				removed: { description: 'Gone.', required: true },
			},
		});

		expect(
			withInputSettings(
				[
					{ name: 'campaign_id', type: 'string' },
					{ name: 'days', type: 'number' },
				],
				settings,
			),
		).toEqual([
			{ name: 'campaign_id', type: 'string', description: 'The ID.', required: true },
			{ name: 'days', type: 'number', description: '', required: false },
		]);
	});
});

describe('applyInputSettings', () => {
	it('gives the schema back when no settings exist', () => {
		expect(applyInputSettings(SCHEMA, new Map())).toBe(SCHEMA);
	});

	it('adds the descriptions and the required inputs, without the null type', () => {
		const schema = applyInputSettings(
			SCHEMA,
			new Map([
				['campaign_id', { description: 'The ID of the campaign.', required: true }],
				['days', { description: '', required: true }],
				['filters', { description: 'Extra filters.', required: false }],
				['removed', { description: 'Gone.', required: true }],
			]),
		);

		expect(schema).toEqual({
			type: 'object',
			properties: {
				campaign_id: { description: 'The ID of the campaign.', type: 'string' },
				days: { description: 'days', anyOf: [{ type: 'number' }] },
				filters: { description: 'Extra filters.' },
			},
			required: ['campaign_id', 'days'],
			additionalProperties: false,
		});
	});

	it('leaves out `required` when no input is required', () => {
		const schema = applyInputSettings(
			SCHEMA,
			new Map([['campaign_id', { description: 'The ID.', required: false }]]),
		);

		expect(schema).not.toHaveProperty('required');
	});
});

describe('missingRequiredInputs', () => {
	const settings = new Map([
		['campaign_id', { description: '', required: true }],
		['days', { description: '', required: true }],
		['filters', { description: '', required: false }],
		['removed', { description: '', required: true }],
	]);
	const names = ['campaign_id', 'days', 'filters'];

	it.each([
		['every required input', { campaign_id: 'c1', days: 0 }, []],
		['a missing input', { campaign_id: 'c1' }, ['days']],
		['a null input', { campaign_id: null, days: false }, ['campaign_id']],
		['no object', 'text', ['campaign_id', 'days']],
		['nothing', undefined, ['campaign_id', 'days']],
	])('finds the missing inputs of a call with %s', (_case, input, missing) => {
		expect(missingRequiredInputs(input, settings, names)).toEqual(missing);
	});
});
