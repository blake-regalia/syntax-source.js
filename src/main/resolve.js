
const R_REFERENCE = /(?<=(?:^|[^\\])(?:\\\\)*)\{\{([A-Za-z0-9_]+)\}\}/g;
const R_LOOKAHEAD_ASSERTION = /(^|[^\\])\(\?=/g;
const R_ANCHORED_LOOKAHEAD_ASSERTION = /^(?:\(\?x\)\s*(?:\(\s*\?\s*[a-z]+\s*\)\s*)*|\(\?[a-z]+\))*\(\?=/g;
const R_ANCHORED_REFERENCE = /^(?:\(\?x\)\s*(?:\(\s*\?\s*[a-z]+\s*\)\s*)*|\(\?[a-z]+\))*\{\{([A-Za-z0-9_]+)\}\}/;

const search_reachable = (h_defined, a_search, as_reachable=new Set()) => {
	for(let s_search of a_search) {
		// first encounter
		if(!as_reachable.has(s_search)) {
			// add to set
			as_reachable.add(s_search);

			// recurse on children
			search_reachable(h_defined, [...h_defined[s_search] || []], as_reachable);
		}
	}

	return as_reachable;
};

const generate_lookahead = (a_lookaheads) => {
	let a_local = [];
	let a_union = [a_local];

	let b_ignore_all = true;

	let xm_ignore_prev = 3;

	for(let g_item of a_lookaheads) {
		// yes ignore
		if(g_item.ignore) {
			// prev is not compatible; shift to new local
			if(!(xm_ignore_prev & 2)) {
				a_local = [];
				a_local.ignore = true;
				a_union.push(a_local);
			}
			// compatible but first
			else if(!a_local.length && 1 === a_union.length) {
				a_local.ignore = true;
			}

			xm_ignore_prev = 2;
		}
		// no ignore
		else {
			// prev is not compatible; shift to new local
			if(!(xm_ignore_prev & 1)) {
				a_local = [];
				a_local.ignore = false;
				a_union.push(a_local);
			}

			xm_ignore_prev = 1;
			b_ignore_all = false;
		}

		// simple regex
		if(g_item.regex) {
			// terrible hack to prevent multiple lookahead assertions
			let s_regex = g_item.regex.replace(R_LOOKAHEAD_ASSERTION, '$1(?:');

			a_local.push(s_regex);
		}
		// dependent on other lookahead
		else if(g_item.lookahead) {
			a_local.push(`{{${g_item.lookahead}_LOOKAHEAD}}`);
		}
		// something else
		else {
			console.assert(`unknown lookahead object struct: '${g_item}'`);
		}
	}

	// prepend ignore flag to localized regex groups
	let s_content = a_union.map((a_local_i) => {
		// wrap each item in non-capture group to keep precedence bound tighter than ultimate OR operator
		let s_local_i = a_local_i.map(s => s.includes('|')? `(?:${s})`: s).join('|');

		// ignore case group
		if(a_local_i.ignore && !b_ignore_all) {
			return `(?:(?i)${s_local_i})`;
		}
		// as-is
		else {
			return s_local_i;
		}
	}).map(s => s.includes('|')? `(?:${s})`: s).join('|');

	// final regex
	return `${b_ignore_all? '(?i)': ''}(?=${s_content})`;
};

const flatten_variable = (g_variable) => {
	let s_regex = g_variable.ignore? '(?i)': '';

	// simple regex
	if(g_variable.regex) {
		return `${s_regex}${g_variable.regex}`;
	}
	// composite
	else if(g_variable.variables) {
		return `${s_regex}${g_variable.variables.map(s => `{{${s}}}`).join('|')}`;
	}
	// something else
	else {
		throw new Error(`unexpected variable structure: ${g_variable}`);
	}
};

const flatten_lookahead = (g_lookahead) => {
	let s_regex = `${g_lookahead.ignore? '(?i)': ''}(?=`;

	// simple regex
	if(g_lookahead.regex) {
		return `${s_regex}${g_lookahead.regex})`;
	}
	// composite
	else if(g_lookahead.lookaheads) {
		return `${s_regex}${g_lookahead.lookaheads.map(s => `{{${s.replace(/[?*^+]$/, '')}_LOOKAHEAD}}`).join('|')})`;
	}
	// something else
	else {
		throw new Error(`unexpected variable structure: ${g_lookahead}`);
	}
};

const define_variable = (h_contexts, h_referenced_vars, as_reachable_vars, h_variables_out, h_dependent_vars, s_variable) => {
	let s_regex;

	// variable is not defined
	if(!h_variables_out[s_variable]) {
		// variable is a lookahead
		if(s_variable.endsWith('_LOOKAHEAD')) {
			let si_context = s_variable.slice(0, -'_LOOKAHEAD'.length);

			// context does not exist
			if(!(si_context in h_contexts)) {
				throw new Error(`cannot generate lookahead for variable '${s_variable}' since no such context exists '${si_context}'`);
			}

			// context has lookaheads
			let a_lookaheads = h_contexts[si_context].lookaheads;
			if(a_lookaheads.length) {
				// generate lookahead variable
				s_regex = h_variables_out[s_variable] = generate_lookahead(a_lookaheads);
			}
			// no lookaheads
			else {
				let s_ctxs_used = '';

				// each defined context
				for(let [si_ctx, a_vars] of Object.entries(h_referenced_vars)) {
					// variable referenced in this context
					if(a_vars.includes(s_variable)) {
						s_ctxs_used += '\n\t'+si_ctx;
					}
				}

				throw new Error(`lookahead variable '${s_variable}' is not defined, nor can it be generated from context\nUsed in the following contexts:${s_ctxs_used}`);
			}
		}
		else {
			let s_ctxs_used = '';

			// each defined context
			for(let [si_ctx, a_vars] of Object.entries(h_referenced_vars)) {
				// variable referenced in this context
				if(a_vars.includes(s_variable)) {
					s_ctxs_used += '\n\t'+si_ctx;
				}
			}

			throw new Error(`variable '${s_variable}' is not defined\nUsed in the following contexts:${s_ctxs_used}`);
		}
	}
	// variable is already defined
	else {
		s_regex = h_variables_out[s_variable];
	}

	// match its regex (save to dependents)
	let a_references = h_dependent_vars[s_variable] = (s_regex.match(R_REFERENCE) || [])
		.map(s => s.slice(2, -2));

	// check all references
	for(let s_ref of a_references) {
		// they are reachable now
		as_reachable_vars.add(s_ref);

		// not defined; define it
		if(!(s_ref in h_variables_out)) {
			define_variable(h_contexts, h_referenced_vars, as_reachable_vars, h_variables_out, h_dependent_vars, s_ref);
		}
	}
};

// const reduce_regexp = () => {

// };

const check_dependents = (h_dependent_vars, a_path, nl_max_path=Infinity,  a_excessive_paths=[]) => {
	let si_variable = a_path[a_path.length-1];
	let a_deps = h_dependent_vars[si_variable];

	// has dependencies
	if(a_deps.length) {
		for(let s_dep of a_deps) {
			if(a_path.includes(s_dep)) {
				throw new Error(`dependency cycle detected at '${a_path.join(' > ')}'`);
			}
			else {
				check_dependents(h_dependent_vars, [...a_path, s_dep], nl_max_path, a_excessive_paths);
			}
		}
	}
	// no more deps (end of path) and excessive; add to list
	else if(a_path.length > nl_max_path) {
		a_excessive_paths.push(a_path);
	}

	return a_excessive_paths;
};

const is_lookahead = (s_regex, h_variables) => {
	// regex starts with lookahead
	if(R_ANCHORED_LOOKAHEAD_ASSERTION.test(s_regex)) {
		return true;
	}
	// does not start with explicity lookahead
	else {
		// regex starts with variable ref
		let m_ref = R_ANCHORED_REFERENCE.exec(s_regex);
		if(m_ref) {
			return is_lookahead(h_variables[m_ref[1]], h_variables);
		}
		// not lookahead
		else {
			return false;
		}
	}
};


const check_acyclic = (h_contexts, h_variables, h_states, a_path) => {
	// top of stack
	let si_context = a_path[a_path.length-1];

	let k_context = h_contexts[si_context];

	let as_transitions = h_states[si_context] = new Set();

	// each rule in context
	for(let [k_rule] of k_context.subrules()) {
		// rule source
		let g_source = k_rule.source;

		// state transition
		if(g_source.set || g_source.push) {
			// match is lookahead
			if(g_source.match && is_lookahead(g_source.match, h_variables)) {
				let s_change;
				let z_change = g_source.set || g_source.push;
				if('string' === typeof z_change) {
					s_change = z_change;
				}
				else {
					s_change = z_change[z_change.length-1];
				}

				as_transitions.add(s_change);
			}
		}
		// include (extensibily a transition)
		else if(g_source.include) {
			as_transitions.add(g_source.include);
		}
	}

	// check each transition in table
	for(let s_state of as_transitions) {
		// cycle detected
		if(a_path.includes(s_state)) {
			throw new Error(`State transition cycle detected at: ${a_path.join(' > ')}`);
		}

		// recurse
		check_acyclic(h_contexts, h_variables, h_states, [...a_path, s_state]);
	}
};


const resolve = (k_syntax, gc_resolve={}) => {
	let {
		lookaheads: h_lookaheads,
		variables: h_variables,
		contexts: h_contexts,
	} = k_syntax;

	let {
		dangerous: b_dangerous,
	} = gc_resolve;

	// save output variables
	let h_variables_out = k_syntax.output_variables = {};

	let h_defined_ctxs = {};

	let h_referenced_ctxs = {};
	let h_referenced_vars = {};

	// flatten variables
	{
		// each variable
		for(let [si_variable, g_variable] of Object.entries(h_variables)) {
			h_variables_out[si_variable] = flatten_variable(g_variable);
		}
	}

	// flatten lookaheads to variables
	{
		// each lookahead
		for(let [si_lookahead, g_lookahead] of Object.entries(h_lookaheads)) {
			h_variables_out[si_lookahead+'_LOOKAHEAD'] = flatten_lookahead(g_lookahead);
		}
	}

	// from all defined contexts, find states reachable and variables referenced
	{
		// each top-level context in syntax
		for(let [si_context, k_context] of Object.entries(h_contexts)) {
			// states reachable from this context
			let as_states_reachable = new Set();

			// each subrule in context
			for(let [k_rule] of k_context.subrules()) {
				// each state in (sub)rule
				for(let s_state of k_rule.states()) {
					// add state to context's set
					as_states_reachable.add(s_state);

					// add state to reference => [...contexts] map
					if(!(s_state in h_referenced_ctxs)) {
						h_referenced_ctxs[s_state] = [si_context];
					}
					else {
						h_referenced_ctxs[s_state].push(si_context);
					}
				}

				// extract variable references
				let a_variables = ('object' === typeof k_rule.source? k_rule.source.match || '': '').match(R_REFERENCE);
				if(a_variables && a_variables.length) {
					// each reference
					for(let s_ref of a_variables) {
						let si_variable = s_ref.slice(2, -2);

						// add to var references
						if(si_context in h_referenced_vars) {
							h_referenced_vars[si_context].push(si_variable);
						}
						else {
							h_referenced_vars[si_context] = [si_variable];
						}
					}
				}
			}

			// set of states reachable from context
			h_defined_ctxs[si_context] = as_states_reachable;
		}
	}


	// terminality of contexts
	let a_warnings_ctxs = [];
	let h_terminalities = {
		// the prototype context is automatically included in all contexts
		prototype: 'included',
	};
	{
		// each subrule in all contexts
		for(let [k_rule] of k_syntax.rules()) {
			// each include
			for(let si_context of k_rule.inclusions()) {
				h_terminalities[si_context] = 'included';
			}
		}

		// each context
		TERMINALITY_ASSIGNMENT:
		for(let [si_context, k_context] of Object.entries(h_contexts)) {
			let a_rules = k_context.rules;

			// context already has terminality defined
			let b_included = (si_context in h_terminalities);

			// each rule in context
			for(let i_rule=0, nl_rules=a_rules.length; i_rule<nl_rules; i_rule++) {
				let g_source = a_rules[i_rule].source;

				// rule uses match
				if(g_source.match) {
					// pop or goto terminal
					if('{{_ANYTHING_LOOKAHEAD}}' === g_source.match) {
						let s_terminality = g_source.pop? 'pop': 'goto';

						// context is included; issue warning
						if(b_included) {
							// skip warning for support context
							if('_OTHERWISE_POP' !== si_context) {
								a_warnings_ctxs.push({
									context: si_context,
									message: `context '${si_context}' will change state via ${s_terminality}, but it is included by another context!`,
								});
							}
						}
						// set terminality
						else {
							h_terminalities[si_context] = s_terminality;
						}
						continue TERMINALITY_ASSIGNMENT;
					}
					// throw or throw-pop terminal
					else if('{{_SOMETHING}}' === g_source.match && g_source.scope && g_source.scope.includes('invalid.illegal.')) {
						let s_terminality = `throw${g_source.pop? '-pop': ''}`;

						// context is included; issue warning
						if(b_included) {
							a_warnings_ctxs.push({
								context: si_context,
								message: `context '${si_context}' will change state via ${s_terminality}, but it is included by another context!`,
							});
						}
						// set terminality
						else {
							h_terminalities[si_context] = s_terminality;
						}
						continue TERMINALITY_ASSIGNMENT;
					}
				}
				// rule includes _OTHERWISE_POP
				else if('_OTHERWISE_POP' === g_source.include) {
					let s_terminality = 'pop';

					// context is included; issue warning
					if(b_included) {
						a_warnings_ctxs.push({
							context: si_context,
							message: `context '${si_context}' will change state via ${s_terminality}, but it is included by another context!`,
						});
					}
					// set terminality
					else {
						h_terminalities[si_context] = s_terminality;
					}
					continue TERMINALITY_ASSIGNMENT;
				}
			}

			// context is included (only got here for warnings); skip
			if(b_included) continue;

			// no terminality deduced; auto-assign
			h_terminalities[si_context] = 'throw-pop';

			// add throw-pop rule
			k_context.add({
				match: '{{_SOMETHING}}',
				scope: `invalid.illegal.token.expected.${si_context}.${k_syntax.ext}`,
				pop: true,
			});

			// add to var references
			if(si_context in h_referenced_vars) {
				h_referenced_vars[si_context].push('_SOMETHING');
			}
			else {
				h_referenced_vars[si_context] = ['_SOMETHING'];
			}
		}
	}

	// check for unclosed paths
	{
		for(let [k_rule, k_context] of k_syntax.rules()) {
			let g_source = k_rule.source;
			let s_action = g_source.set? 'set': 'push';
			if(g_source[s_action]) {
				let a_change = g_source[s_action];
				if('string' === typeof a_change) {
					a_change = g_source[s_action] = [a_change];
				}

				for(let i_state=0, nl_states=a_change.length; i_state<nl_states; i_state++) {
					let s_state = a_change[i_state];

					if('included' === h_terminalities[s_state]) {
						// safety correction disabled; issue warning
						if(b_dangerous) {
							console.warn(`context '${k_context.id}' state changes to unclosed context '${s_state}'`);
						}
						// auto fix
						else {
							console.warn(`context '${k_context.id}' state changes to unclosed context '${s_state}'; automatically fixed`);
							let s_state_throw = a_change[i_state] = `${s_state}^`;

							// state did not exist
							if(!(s_state_throw in h_contexts)) {
								// state not yet exists; add it
								if(!(s_state_throw in k_syntax.contexts)) {
									let k_context_throw = k_syntax.append(s_state_throw, [
										{
											include: s_state,
										},
										{
											match: /* syntax: sublime-syntax.regex */ `'{{_SOMETHING}}'`.slice(1, -1),
											scope: `invalid.illegal.token.expected.${s_state}.${k_syntax.ext}`,
											pop: true,
										},
									]);

									// add lookaheads to context
									k_context_throw.lookaheads = [{
										lookaheads: s_state,
									}];
								}
							}
						}
					}
				}
			}
		}
	}


	// deduce which contexts are reachable
	let as_reachable_ctxs;
	{
		// find all reachable contexts
		as_reachable_ctxs = search_reachable(h_defined_ctxs, ['prototype', 'main']);

		// test each context for reachability
		for(let si_context in h_defined_ctxs) {
			// not reachable
			if(!as_reachable_ctxs.has(si_context)) {
				// print
				console.warn(`removed unreachable context '${si_context}'`);

				// remove context
				delete h_contexts[si_context];
			}
		}
	}


	// issue warnings
	{
		// each context warning
		for(let {context:si_context, message:s_message} of a_warnings_ctxs) {
			// context is reachable; issue warning
			if(as_reachable_ctxs.has(si_context)) {
				console.warn(s_message);
			}
		}
	}


	// deduce which variables are transitively reachable including via dependent variables
	let as_reachable_vars;
	let h_dependent_vars = {};
	{
		// deduce which variables are reachable from contexts
		let as_root_reachable_vars;
		{
			let a_root_reachable_vars = [];

			// each reachable context
			for(let s_state of as_reachable_ctxs) {
				// append variables to reachable list
				a_root_reachable_vars.push(...(h_referenced_vars[s_state] || []));
			}

			// reduce list to set
			as_root_reachable_vars = new Set(a_root_reachable_vars);
		}

		// from all defined variables, find variables referenced (i.e., dependent variables)
		{
			// each variable
			for(let [si_variable, s_regex] of Object.entries(h_variables_out)) {
				// extract dependencies
				h_dependent_vars[si_variable] = (s_regex.match(R_REFERENCE) || [])
					.map(s => s.slice(2, -2));
			}
		}

		// save to search set
		as_reachable_vars = search_reachable(h_dependent_vars, [...as_root_reachable_vars]);
	}


	// generate completable variables (lookaheads)
	{
		// each reachable variable
		for(let s_variable of as_reachable_vars) {
			// define it
			define_variable(h_contexts, h_referenced_vars, as_reachable_vars, h_variables_out, h_dependent_vars, s_variable);
		}
	}

	// deduce which variables are globally unused
	{
		// each variable
		for(let si_variable in h_variables_out) {
			// unused variable
			if(!as_reachable_vars.has(si_variable)) {
				// print
				console.warn(`removed unused variable '${si_variable}'`);

				// remove variable
				delete h_variables_out[si_variable];
				delete h_dependent_vars[si_variable];
			}
		}
	}

	// check for variable DAG and max reference depth
	{
		let nl_max_path = 7;  // usually 8 but reduces to 7 when other errors are present

		let a_excessive_paths = [];
		for(let si_variable in h_dependent_vars) {
			a_excessive_paths.push(...check_dependents(h_dependent_vars, [si_variable], nl_max_path));
		}

		let h_expanded = {};
		for(let a_path of a_excessive_paths) {
			let nl_path = a_path.length;

			for(let i_step=nl_path-1; i_step>=nl_max_path-1; i_step--) {
				let si_dep = a_path[i_step];

				// dependency not yet defined
				if(!(si_dep in h_expanded)) {
					h_expanded[si_dep] = h_variables_out[si_dep]
						.replace(R_REFERENCE, (s_match, si_ref) => (
							h_expanded[si_ref] || h_variables_out[si_ref]
						).replace(R_LOOKAHEAD_ASSERTION, '$1(?:'));
				}

				// replace
				h_variables_out[si_dep] = h_expanded[si_dep];
			}
		}
	}


	// make sure every context reference is defined
	{
		for(let s_state in h_referenced_ctxs) {
			// reference is not reachable; skip
			if(!(s_state in h_contexts)) continue;

			// reference is not defined
			if(!(s_state in h_defined_ctxs)) {
				throw new Error(`state '${s_state}' is referenced but not defined; appears in contexts [${h_referenced_ctxs[s_state].join(', ')}]`);
			}
		}
	}


	// check for context DAG
	{
		let h_states = {};

		// start with main
		check_acyclic(h_contexts, h_variables_out, h_states, ['main']);

		// add prototype
		if(h_contexts.prototype) {
			check_acyclic(h_contexts, h_variables_out, h_states, ['prototype']);
		}

		// check remaining contexts
		for(let si_context in h_contexts) {
			// context hasn't been checked yet
			if(!(si_context in h_states)) {
				check_acyclic(h_contexts, h_variables_out, h_states, [si_context]);
			}
		}
	}

	// determine necessity for failsafe context 'flush'
	// {
	// 	let k_context_main = k_syntax.contexts.main;

	// 	let g_rule_flush = {
	// 		match: '_SOMETHING',
	// 		scope: `invalid.illegal.unknown.flush.${k_syntax.ext}`,
	// 		pop: true,
	// 	};

	// 	let b_flush = false;

	// 	// each rule in context
	// 	for(let [k_rule] of k_context_main.subrules()) {
	// 		// rule source
	// 		let g_source = k_rule.source;

	// 		// state transition
	// 		let s_action = g_source.set? 'set': 'push';
	// 		if(g_source[s_action]) {
	// 			// match is lookahead
	// 			if(g_source.match && is_lookahead(g_source.match, h_variables_out)) {
	// 				let a_change = g_source[s_action];
	// 				if('string' === typeof a_change) {
	// 					a_change = [a_change];
	// 				}

	// 				// prepend flush state
	// 				g_source[s_action] = ['_FLUSH', ...a_change];
	// 				b_flush = true;
	// 			}
	// 		}
	// 	}

	// 	// append flush context
	// 	if(b_flush) {
	// 		k_syntax.append('_FLUSH', [g_rule_flush]);
	// 	}
	// 	// append flush state to main context in case it includes
	// 	else {
	// 		k_context_main.add(g_rule_flush);
	// 	}
	// }

	return k_syntax;
};

module.exports = resolve;
