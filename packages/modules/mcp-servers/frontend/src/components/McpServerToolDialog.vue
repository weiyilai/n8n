<script setup lang="ts">
import {
	MCP_SERVER_TOOL_NAME_MAX_LENGTH,
	mcpServerToolNameSchema,
	type McpServerToolDetailResponse,
	type McpServerToolDraftField,
	type McpServerToolInputSettings,
	type McpServerToolKind,
	type McpServerToolResponse,
	type UpdateMcpServerToolDto,
} from '@n8n/api-types';
import { N8nButton, N8nIcon, N8nTabs, type IconName, type TabOptions } from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
import { computed, ref, watch } from 'vue';

import McpServerToolModalShell from './McpServerToolModalShell.vue';
import McpServerWorkflowToolContent from './McpServerWorkflowToolContent.vue';

const KIND_ICONS: Record<McpServerToolKind, IconName> = {
	workflow: 'workflow',
	node: 'wrench',
	agent: 'bot',
	skill: 'book-open',
};

const props = withDefaults(
	defineProps<{
		tool: McpServerToolResponse | null;
		detail?: McpServerToolDetailResponse | null;
		detailLoading?: boolean;
		detailError?: boolean;
		canUpdate: boolean;
		/** The builder can edit, and the n8n Assistant can write drafts. */
		canGenerate?: boolean;
		/** The first draft after the add runs. */
		drafting?: boolean;
		/** A save request is running for this tool. */
		saving?: boolean;
		/** A remove request is running for this tool. */
		removing?: boolean;
		/** The fields for which a "Generate" call runs. */
		generating?: McpServerToolDraftField[];
		/** Latest non-persisted "Generate" draft for each field, applied only on Save. */
		draftedName?: { value: string; revision: number } | null;
		draftedDescription?: { value: string; revision: number } | null;
		/** The inputs for which a "Generate" call runs. */
		generatingInputs?: string[];
		/** Latest non-persisted "Generate" draft of each input description, applied only on Save. */
		draftedInputDescriptions?: Record<string, { value: string; revision: number }>;
		/** The URL of the source workflow, which opens in a new tab. */
		workflowHref: string | null;
	}>(),
	{
		detail: null,
		detailLoading: false,
		detailError: false,
		canGenerate: false,
		drafting: false,
		saving: false,
		removing: false,
		generating: () => [],
		draftedName: null,
		draftedDescription: null,
		generatingInputs: () => [],
		draftedInputDescriptions: () => ({}),
	},
);

const emit = defineEmits<{
	close: [];
	save: [changes: UpdateMcpServerToolDto];
	remove: [];
	generate: [field: Exclude<McpServerToolDraftField, 'inputDescription'>];
	generateInput: [name: string];
	retryDetail: [];
}>();

const i18n = useI18n();
/** Kept across close so the dialog header and body do not clear during the fade-out animation. */
const displayedTool = ref<McpServerToolResponse | null>(props.tool);
const displayedDetail = ref<McpServerToolDetailResponse | null>(props.detail);
const displayedWorkflowHref = ref<string | null>(props.workflowHref);
const toolName = ref('');
const description = ref('');
/** The edited settings of each trigger input, by input name. */
const inputSettings = ref<Record<string, McpServerToolInputSettings>>({});
/** The last loaded detail of the open tool, to see which input settings changed on the server. */
let loadedDetail: McpServerToolDetailResponse | null = null;
/** The revision of the last "Generate" draft applied to each input. */
let appliedInputRevisions: Record<string, number> = {};
const tab = ref<'general' | 'advanced'>('general');

watch(
	() => props.tool,
	(tool, previous) => {
		if (!tool) return;
		displayedTool.value = tool;
		displayedWorkflowHref.value = props.workflowHref;
		const openedOrSwitched = !previous || tool.id !== previous.id;
		if (openedOrSwitched) {
			toolName.value = tool.toolName;
			description.value = tool.description;
			inputSettings.value = {};
			loadedDetail = null;
			appliedInputRevisions = {};
			tab.value = 'general';
			return;
		}
		if (tool.toolName !== previous.toolName) {
			toolName.value = tool.toolName;
		}
		if (tool.description !== previous.description) {
			description.value = tool.description;
		}
	},
	{ immediate: true },
);

function settingsOf(input: McpServerToolInputSettings): McpServerToolInputSettings {
	return { description: input.description, required: input.required };
}

watch(
	() => props.detail,
	(detail) => {
		if (!props.tool) return;
		displayedDetail.value = detail;
		if (!detail || detail.id !== props.tool.id) return;
		// A reload keeps the edits of the builder. Only inputs that changed on the server change here.
		const previous = loadedDetail?.id === detail.id ? loadedDetail : null;
		const next = { ...inputSettings.value };
		for (const input of detail.inputs) {
			const before = previous?.inputs.find(({ name }) => name === input.name);
			const changedOnServer =
				!before || before.description !== input.description || before.required !== input.required;
			if (!(input.name in next) || changedOnServer) next[input.name] = settingsOf(input);
		}
		inputSettings.value = next;
		loadedDetail = detail;
	},
	{ immediate: true },
);

watch(
	() => props.draftedInputDescriptions,
	(drafts) => {
		if (!props.tool) return;
		for (const [name, draft] of Object.entries(drafts)) {
			if ((appliedInputRevisions[name] ?? 0) >= draft.revision) continue;
			appliedInputRevisions[name] = draft.revision;
			const current = inputSettings.value[name] ?? { description: '', required: false };
			inputSettings.value = {
				...inputSettings.value,
				[name]: { ...current, description: draft.value },
			};
		}
	},
	{ deep: true },
);

watch(
	() => props.workflowHref,
	(href) => {
		if (props.tool) displayedWorkflowHref.value = href;
	},
);

watch(
	() => props.draftedName,
	(draft) => {
		if (props.tool && draft) toolName.value = draft.value;
	},
);

watch(
	() => props.draftedDescription,
	(draft) => {
		if (props.tool && draft) description.value = draft.value;
	},
);

const open = computed({
	get: () => props.tool !== null,
	set: (value: boolean) => {
		if (!value) emit('close');
	},
});

const kindIcon = computed<IconName>(() =>
	displayedTool.value ? KIND_ICONS[displayedTool.value.kind] : 'workflow',
);
const isGeneratingName = computed(() => props.generating.includes('toolName'));
const isGeneratingDescription = computed(() => props.generating.includes('description'));
// A broken tool has no published workflow to read, so the server refuses its draft.
const showGenerate = computed(
	() => props.canGenerate && !props.drafting && !displayedTool.value?.brokenReason,
);
const nameInvalid = computed(() => !mcpServerToolNameSchema.safeParse(toolName.value).success);
const titleError = computed(() =>
	props.canUpdate && !props.drafting && nameInvalid.value
		? i18n.baseText('mcpServers.tools.row.toolNameInvalid')
		: '',
);
const titleHint = computed(() =>
	props.canUpdate && !props.drafting && !nameInvalid.value
		? i18n.baseText('mcpServers.tools.row.toolNameHint')
		: '',
);
const busy = computed(() => props.saving || props.removing);
const saveDisabled = computed(
	() =>
		props.drafting ||
		isGeneratingName.value ||
		isGeneratingDescription.value ||
		props.generatingInputs.length > 0,
);
const isWorkflowTool = computed(() => displayedTool.value?.kind === 'workflow');
/** An input without a description makes AI clients guess its value, so "Advanced" shows a dot. */
const inputMissesDescription = computed(
	() =>
		!props.drafting &&
		(displayedDetail.value?.inputs ?? []).some(
			({ name }) => (inputSettings.value[name]?.description ?? '').trim() === '',
		),
);
const tabOptions = computed<Array<TabOptions<'general' | 'advanced'>>>(() => [
	{ value: 'general', label: i18n.baseText('mcpServers.tools.modal.tabs.general') },
	{
		value: 'advanced',
		label: i18n.baseText('mcpServers.tools.modal.tabs.advanced'),
		notification: inputMissesDescription.value,
	},
]);

/** The input settings that differ from the loaded detail, with trimmed descriptions. */
function changedInputs(): Record<string, McpServerToolInputSettings> {
	const detail = displayedDetail.value;
	if (!detail || !props.tool || detail.id !== props.tool.id) return {};
	const entries: Array<[string, McpServerToolInputSettings]> = [];
	for (const input of detail.inputs) {
		const edited = inputSettings.value[input.name];
		if (!edited) continue;
		const next = { description: edited.description.trim(), required: edited.required };
		if (next.description !== input.description || next.required !== input.required) {
			entries.push([input.name, next]);
		}
	}
	return Object.fromEntries(entries);
}

function handleSave() {
	if (!props.tool || !props.canUpdate || props.drafting || busy.value || nameInvalid.value) return;
	const changes: UpdateMcpServerToolDto = {};
	if (toolName.value !== props.tool.toolName) {
		changes.toolName = toolName.value;
	}
	const trimmedDescription = description.value.trim();
	if (trimmedDescription !== props.tool.description) {
		changes.description = trimmedDescription;
	}
	const inputs = changedInputs();
	if (Object.keys(inputs).length > 0) {
		changes.inputs = inputs;
	}
	if (Object.keys(changes).length === 0) {
		emit('close');
		return;
	}
	emit('save', changes);
}
</script>

<template>
	<McpServerToolModalShell
		v-model:open="open"
		:title="toolName"
		:editable-title="canUpdate && !drafting"
		:title-max-length="MCP_SERVER_TOOL_NAME_MAX_LENGTH"
		:title-error="titleError"
		:title-hint="titleHint"
		:title-loading="isGeneratingName"
		:aria-description="i18n.baseText('mcpServers.tools.dialog.ariaDescription')"
		:can-update="canUpdate"
		:saving="saving"
		:save-disabled="saveDisabled"
		:busy="busy"
		@update:title="toolName = $event"
		@save="handleSave"
	>
		<template #titlePrefix>
			<N8nIcon :icon="kindIcon" :size="18" />
		</template>

		<template v-if="showGenerate" #titleFooterAction>
			<N8nButton
				variant="ghost"
				size="xsmall"
				:label="i18n.baseText('mcpServers.tools.row.generate')"
				:disabled="isGeneratingName || busy"
				:class="$style.generate"
				data-test-id="mcp-tool-dialog-generate-name"
				data-attr="mcp-tool-dialog-generate-name"
				@click="emit('generate', 'toolName')"
			/>
		</template>

		<template v-if="isWorkflowTool" #tabs>
			<N8nTabs
				v-model="tab"
				:options="tabOptions"
				size="small"
				data-test-id="mcp-tool-dialog-tab-list"
			/>
		</template>

		<McpServerWorkflowToolContent
			v-if="displayedTool && displayedTool.kind === 'workflow'"
			v-model:description="description"
			v-model:input-settings="inputSettings"
			:tab="tab"
			:tool="displayedTool"
			:detail="displayedDetail"
			:detail-loading="detailLoading"
			:detail-error="detailError"
			:can-update="canUpdate"
			:show-generate="showGenerate"
			:drafting="drafting"
			:generating-description="isGeneratingDescription"
			:generating-inputs="generatingInputs"
			:busy="busy"
			:workflow-href="displayedWorkflowHref"
			@generate-description="emit('generate', 'description')"
			@generate-input="emit('generateInput', $event)"
			@retry-detail="emit('retryDetail')"
		/>

		<template v-if="canUpdate" #footerLeft>
			<N8nButton
				variant="ghost"
				icon="trash-2"
				:label="i18n.baseText('mcpServers.tools.row.remove')"
				:loading="removing"
				:disabled="busy"
				data-test-id="mcp-tool-dialog-remove"
				data-attr="mcp-tool-dialog-remove"
				@click="emit('remove')"
			/>
		</template>
	</McpServerToolModalShell>
</template>

<style lang="scss" module>
// "Generate": a small text button with no border and no background.
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
</style>
