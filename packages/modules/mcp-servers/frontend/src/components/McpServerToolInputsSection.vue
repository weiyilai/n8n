<script setup lang="ts">
import {
	MCP_SERVER_TOOL_INPUT_DESCRIPTION_MAX_LENGTH,
	type McpServerToolInputField,
	type McpServerToolInputSettings,
} from '@n8n/api-types';
import {
	N8nBadge,
	N8nButton,
	N8nInput,
	N8nLoading,
	N8nSpinner,
	N8nSwitch,
	N8nText,
} from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
import { useId } from 'vue';

// The trigger inputs of a workflow tool. Each input has a description that AI clients read, and a
// "Required" setting. A builder edits both. A viewer sees them as text.
const props = defineProps<{
	inputs: McpServerToolInputField[];
	loading: boolean;
	error: boolean;
	canUpdate: boolean;
	showGenerate: boolean;
	/** The names of the inputs for which a "Generate" call runs. */
	generating: string[];
	/** The first draft after the add runs, so the builder cannot edit yet. */
	drafting: boolean;
	busy?: boolean;
}>();

/** The edited settings, by input name. */
const settings = defineModel<Record<string, McpServerToolInputSettings>>('settings', {
	required: true,
});

const emit = defineEmits<{
	generate: [name: string];
	'retry-detail': [];
}>();

const i18n = useI18n();
const idPrefix = useId();

function setting(name: string): McpServerToolInputSettings {
	return settings.value[name] ?? { description: '', required: false };
}

function update(name: string, change: Partial<McpServerToolInputSettings>) {
	settings.value = { ...settings.value, [name]: { ...setting(name), ...change } };
}

function isGenerating(name: string) {
	return props.generating.includes(name);
}

/** Input names can hold any character, so the element IDs use the position. */
function descriptionId(index: number) {
	return `${idPrefix}-input-${index}-description`;
}

function requiredId(index: number) {
	return `${idPrefix}-input-${index}-required`;
}
</script>

<template>
	<section :class="$style.section" data-test-id="mcp-tool-dialog-inputs-section">
		<div :class="$style.title">
			<N8nText tag="h4" size="small" bold>
				{{ i18n.baseText('mcpServers.tools.modal.inputs.title') }}
			</N8nText>
			<N8nText v-if="!loading && !error" size="small" color="text-light">
				{{ inputs.length }}
			</N8nText>
		</div>
		<N8nText tag="p" size="small" color="text-light">
			{{ i18n.baseText('mcpServers.tools.modal.inputs.intro') }}
		</N8nText>

		<N8nLoading v-if="loading" :rows="2" data-test-id="mcp-tool-dialog-inputs-loading" />
		<div v-else-if="error" :class="$style.errorRow" data-test-id="mcp-tool-dialog-detail-error">
			<N8nText size="small" color="danger" role="alert">
				{{ i18n.baseText('mcpServers.tools.modal.detailLoadError') }}
			</N8nText>
			<N8nButton
				variant="ghost"
				size="xsmall"
				:label="i18n.baseText('mcpServers.tools.modal.retry')"
				data-test-id="mcp-tool-dialog-detail-retry"
				@click="emit('retry-detail')"
			/>
		</div>
		<N8nText
			v-else-if="inputs.length === 0"
			size="small"
			color="text-light"
			data-test-id="mcp-tool-dialog-inputs-empty"
		>
			{{ i18n.baseText('mcpServers.tools.modal.inputs.empty') }}
		</N8nText>
		<div v-else :class="$style.list" role="list" data-test-id="mcp-tool-dialog-inputs">
			<div
				v-for="(field, index) in inputs"
				:key="field.name"
				role="listitem"
				:aria-label="field.name"
				:class="$style.input"
				data-test-id="mcp-tool-dialog-input-row"
			>
				<div :class="$style.inputHeader">
					<N8nText size="small" :class="$style.fieldName" data-test-id="mcp-tool-dialog-input-name">
						{{ field.name }}
					</N8nText>
					<N8nBadge theme="tertiary" size="small" data-test-id="mcp-tool-dialog-input-type">
						{{ field.type }}
					</N8nBadge>
					<div v-if="canUpdate" :class="$style.required">
						<label :for="requiredId(index)" :class="$style.requiredLabel">
							<N8nText size="small">
								{{ i18n.baseText('mcpServers.tools.modal.inputs.required') }}
							</N8nText>
						</label>
						<N8nSwitch
							:id="requiredId(index)"
							:model-value="setting(field.name).required"
							size="small"
							:disabled="drafting || busy"
							:aria-label="
								i18n.baseText('mcpServers.tools.modal.inputs.requiredAriaLabel', {
									interpolate: { name: field.name },
								})
							"
							data-test-id="mcp-tool-dialog-input-required"
							@update:model-value="update(field.name, { required: $event })"
						/>
					</div>
					<N8nText
						v-else
						size="small"
						color="text-light"
						:class="$style.required"
						data-test-id="mcp-tool-dialog-input-required-readonly"
					>
						{{
							setting(field.name).required
								? i18n.baseText('mcpServers.tools.modal.inputs.required')
								: i18n.baseText('mcpServers.tools.modal.inputs.optional')
						}}
					</N8nText>
				</div>

				<template v-if="canUpdate">
					<label :for="descriptionId(index)" :class="$style.subLabel">
						{{ i18n.baseText('mcpServers.tools.row.description') }}
					</label>
					<N8nInput
						:id="descriptionId(index)"
						:model-value="setting(field.name).description"
						type="textarea"
						:rows="2"
						:maxlength="MCP_SERVER_TOOL_INPUT_DESCRIPTION_MAX_LENGTH"
						:placeholder="i18n.baseText('mcpServers.tools.modal.inputs.descriptionPlaceholder')"
						:disabled="drafting || isGenerating(field.name) || busy"
						:class="$style.resizable"
						data-test-id="mcp-tool-dialog-input-description"
						@update:model-value="update(field.name, { description: String($event) })"
					>
						<template v-if="isGenerating(field.name)" #suffix>
							<N8nSpinner
								size="small"
								:class="$style.textareaSpinner"
								data-test-id="mcp-tool-dialog-input-generating"
							/>
						</template>
					</N8nInput>
					<div v-if="showGenerate" :class="$style.inputFooter">
						<N8nButton
							variant="ghost"
							size="xsmall"
							:label="i18n.baseText('mcpServers.tools.row.generate')"
							:disabled="isGenerating(field.name) || busy"
							:class="$style.generate"
							data-test-id="mcp-tool-dialog-input-generate"
							data-attr="mcp-tool-dialog-input-generate"
							@click="emit('generate', field.name)"
						/>
					</div>
				</template>
				<N8nText
					v-else
					tag="p"
					size="small"
					:color="setting(field.name).description ? 'text-dark' : 'text-light'"
					:class="$style.readonlyDescription"
					data-test-id="mcp-tool-dialog-input-description-readonly"
				>
					{{
						setting(field.name).description || i18n.baseText('mcpServers.tools.row.noDescription')
					}}
				</N8nText>
			</div>
		</div>
	</section>
</template>

<style lang="scss" module>
@use '@n8n/design-system/css/mixins/utils';

.section {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--2xs);
}

.title {
	display: flex;
	align-items: center;
	gap: var(--spacing--2xs);
}

.errorRow {
	display: flex;
	align-items: center;
	gap: var(--spacing--2xs);
}

.list {
	display: flex;
	flex-direction: column;
	border: var(--border);
	border-radius: var(--radius);
}

.input {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--3xs);
	padding: var(--spacing--xs);

	& + & {
		border-top: var(--border);
	}
}

.inputHeader {
	display: flex;
	align-items: center;
	gap: var(--spacing--2xs);
	min-width: 0;
}

.fieldName {
	font-family: var(--font-family--monospace);
	min-width: 0;
	@include utils.utils-ellipsis;
}

.required {
	display: flex;
	align-items: center;
	gap: var(--spacing--2xs);
	flex: none;
	margin-inline-start: auto;
}

.requiredLabel {
	cursor: pointer;
}

.subLabel {
	margin-top: var(--spacing--3xs);
	font-size: var(--font-size--2xs);
	font-weight: var(--font-weight--medium);
	color: var(--text-color--subtle);
}

.textareaSpinner {
	margin: var(--spacing--xs) var(--spacing--xs) 0 0;
}

.resizable :global(textarea) {
	resize: vertical;
}

.readonlyDescription {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.inputFooter {
	display: flex;
	justify-content: flex-end;

	// "Generate": the same small text button as below the tool description. Two classes, to win
	// over the size and variant classes of N8nButton.
	.generate {
		--button--color: var(--text-color--subtle);
		--button--color--background-hover: transparent;
		--button--color--background-active: transparent;
		--button--padding: 0;
		flex: none;
		font-style: italic;
		font-weight: var(--font-weight--regular);

		&:hover:not(:disabled) {
			--button--color: var(--text-color);
		}
	}
}
</style>
