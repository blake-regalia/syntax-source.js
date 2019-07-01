const yaml = require('js-yaml');

/* eslint-disable indent */
module.exports = (k_syntax, gc_export={}) => `
%YAML 1.2
---
${yaml.safeDump((gc_export.post || (g => g))({
	...k_syntax.other,
	variables: k_syntax.output_variables,
	contexts: Object.entries(k_syntax.contexts)
		.reduce((h_contexts, [si_context, k_context]) => ({
			...h_contexts,
			[si_context]: k_context.export(),
		}), {}),
}), {
	noRefs: true,
	noCompatMode: true,
	lineWidth: 600,
	schema: yaml.DEFAULT_FULL_SCHEMA,
})}`.trim();
/* eslint-enable indent */
