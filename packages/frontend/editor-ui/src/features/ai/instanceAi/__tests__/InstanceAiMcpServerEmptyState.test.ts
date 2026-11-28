import { render } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import InstanceAiMcpServerEmptyState from '../components/InstanceAiMcpServerEmptyState.vue';

vi.mock('@n8n/frontend-module-mcp-servers', () => ({
	loadMcpServerAssistantIntro: async () =>
		defineComponent({
			props: { projectId: String, serverId: String },
			emits: ['select'],
			setup:
				(props, { emit }) =>
				() =>
					h(
						'button',
						{
							'data-test-id': 'intro',
							'data-project-id': props.projectId,
							'data-server-id': props.serverId,
							onClick: () =>
								emit('select', { text: 'Suggestion', prefillType: 'mcp_server_suggestion' }),
						},
						'Suggestion',
					),
		}),
}));

describe('InstanceAiMcpServerEmptyState', () => {
	it('renders the module intro for the server and forwards its suggestion', async () => {
		const { getByTestId, emitted } = render(InstanceAiMcpServerEmptyState, {
			props: { projectId: 'project-1', serverId: 'srv-1' },
		});
		await flushPromises();

		const intro = getByTestId('intro');
		expect(intro).toHaveAttribute('data-project-id', 'project-1');
		expect(intro).toHaveAttribute('data-server-id', 'srv-1');

		await userEvent.click(intro);
		expect(emitted('select')).toEqual([
			[{ text: 'Suggestion', prefillType: 'mcp_server_suggestion' }],
		]);
	});
});
