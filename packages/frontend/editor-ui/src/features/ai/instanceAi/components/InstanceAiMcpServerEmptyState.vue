<script setup lang="ts">
import type { InstanceAiPrefillPayload } from '@n8n/api-types';
import { loadMcpServerAssistantIntro } from '@n8n/frontend-module-mcp-servers';
import { defineAsyncComponent } from 'vue';

defineProps<{
	projectId: string;
	serverId: string;
}>();

const emit = defineEmits<{
	select: [prefill: InstanceAiPrefillPayload];
}>();

const McpServerAssistantIntro = defineAsyncComponent(loadMcpServerAssistantIntro);
</script>

<template>
	<McpServerAssistantIntro
		:project-id="projectId"
		:server-id="serverId"
		@select="emit('select', $event)"
	/>
</template>
