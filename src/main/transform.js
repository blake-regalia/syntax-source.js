const resolve = require('../main/resolve.js');

const R_KEY_EXTENSION = /^([^.]+)(?:\.(.+))?$/;
const R_QUANTIFIER = /^(.+?)([?*+^])$/;

const H_CASES_MIXED = {
	upper: s => s.toUpperCase(),
	lower: s => s.toLowerCase(),
	proper: s => s[0].toUpperCase()+s.slice(1).toLowerCase(),
	mixed: s => `(?i)${s}`,
};

const H_CASES_EXTENDED = {
	camel: s => s[0].toLowerCase()+s.slice(1),
	pascal: s => s[0].toUpperCase()+s.slice(1),
	...H_CASES_MIXED,
};

const H_SYMBOL_DEFAULTS = {
	paren: {
		open: '\\(',
		close: '\\)',
	},
	brace: {
		open: '\\{',
		close: '\\}',
	},
	bracket: {
		open: '\\[',
		close: '\\]',
	},
	tag: {
		open: '<',
		close: '>',
	},
	irk: {
		open: '\'',
		close: '\'',
	},
	dirk: {
		open: '"',
		close: '"',
	},
};

const plug = (s_input, h_replace) => {
	let s_out = s_input;
	for(let [s_key, s_ins] of Object.entries(h_replace)) {
		let r_plug = new RegExp(`(^|[-.\\s])${s_key.toUpperCase()}([-.\\s]|$)`, 'g');
		s_out = s_out.replace(r_plug, `$1${s_ins}$2`);
	}
	return s_out;
};

const rule_throw = (h_env, s_state, b_pop=false) => ({
	match: /* syntax: sublime-syntax.regex */ `'{{_SOMETHING}}'`.slice(1, -1),
	scope: `invalid.illegal.token.expected.${s_state}.${h_env.syntax}`,
	...(b_pop? {pop:b_pop}: {}),
});

const normalize_dst = (w_dst) => {
	if('string' === typeof w_dst) {
		return [w_dst];
	}
	else if(Array.isArray(w_dst)) {
		return w_dst;
	}
	else {
		throw new Error(`invalid context destination: '${w_dst}'`);
	}
};

const string_to_regex = s => s.replace(/([.|?*+[\](){}\\^$])/g, '\\$1');

const normalize_insert_spec = (g_spec, a_stack=[]) => {
	let b_pop = false;
	if(g_spec.pop) {
		b_pop = true;
	}
	else if(g_spec.set) {
		b_pop = true;
		a_stack.unshift(...(Array.isArray(g_spec.set)? g_spec.set: [g_spec.set]));
	}
	else if(g_spec.push) {
		a_stack.unshift(...(Array.isArray(g_spec.push)? g_spec.push: [g_spec.push]));
	}

	return {
		...g_spec,
		pop: b_pop,
		stack: a_stack,
		action: (b_pop
			? (a_stack.length
				? {set:a_stack}
				: {pop:true})
			: {push:a_stack}),
	};
};

const resolve_scope = (g_source, s_default, s_always=null) => {
	// make scope
	let s_scope = g_source.scope || s_default;

	// add
	if(g_source.add) {
		// ref add
		let z_add = g_source.add;

		// cast to string
		let s_add = z_add;

		// convert array
		if(Array.isArray(z_add)) {
			s_add = z_add.join(' ');
		}
		// invalid type
		else if('string' !== typeof z_add) {
			throw new Error(`invalid value type given for add: '${z_add}'`);
		}

		// append
		s_scope = `${s_scope? s_scope+' ': ''}${s_add}`;
	}

	return `${s_scope}${s_always? ' '+s_always: ''}`;
};

const insert_word = (h_env, k_context, i_rule, k_rule, s_word, s_tag) => {
	let g_source = k_rule.source;

	// lookahead
	let s_boundary = g_source.boundary || '{{_WORD_BOUNDARY}}';

	// type
	let s_type = g_source.type || '';

	// case selector
	let h_cases = H_CASES_MIXED;

	// tag exists
	if(s_tag) {
		// invalid tag
		if(!['auto', 'exact', ...Object.keys(H_CASES_EXTENDED)].includes(s_tag)) {
			throw new Error(`invalid case tag '${s_tag}'`);
		}

		// camel tag or resolved auto
		if('camel' === s_tag || ('auto' === s_tag && s_word !== s_word.toLowerCase())) {
			h_cases = H_CASES_EXTENDED;
		}
		// strict mode; use single permutation
		else if(s_tag in H_CASES_EXTENDED) {
			h_cases = {[s_tag]:H_CASES_EXTENDED[s_tag]};
		}
		// exact
		else if('exact' === s_tag) {
			h_cases = {exact:s => s};
		}
	}

	// each predefined case
	for(let [s_case, f_case] of Object.entries(h_cases)) {
		// create permutation to rule
		let g_rule_insert = {
			match: `${f_case(string_to_regex(s_word))}(?=${s_boundary})`,
			...k_rule.clone(i_rule)
				.scopes(s_scope => plug(s_scope, {
					case: s_case,
					word: s_word,
				}))
				.mod(g_source_sub => ({
					...g_source_sub,
					scope: plug(resolve_scope(
						g_source,
						`keyword.operator.word.${s_type? s_type+'.': ''}WORD.SYNTAX`,
						'exact' === s_tag? '': `meta.case.CASE.SYNTAX`
					), {
						case: s_case,
						word: s_word,
						syntax: h_env.syntax,
					}),
				}))
				.export(),
		};

		// delete special keys
		delete g_rule_insert.boundary;
		delete g_rule_insert.type;

		// insert permutation
		k_context.insert(i_rule++, g_rule_insert);
	}

	// add lookahead to context
	k_context.lookaheads.push({
		regex: `${s_word}\\b`,
		ignore: true,
	});

	return i_rule;
};

const insert_symbol = (h_env, k_context, k_rule, s_scope_frag, s_symbol, s_which, s_side) => {
	// invalid symbol
	if(!s_symbol || !(s_symbol in H_SYMBOL_DEFAULTS)) {
		throw new Error(`invalid ${s_which} symbol '${s_symbol}'`);
	}

	// remove source rule from context
	let i_rule = k_context.drop(k_rule);

	// ref symbol default
	let g_symbol = H_SYMBOL_DEFAULTS[s_symbol];

	// ammend rule source
	k_context.insert(i_rule++, {
		match: g_symbol[s_which],
		...k_rule.clone(i_rule)
			.scopes(s_scope => plug(s_scope, {
				symbol: s_symbol,
			}))
			.mod(g_source_sub => ({
				...g_source_sub,
				scope: plug(resolve_scope(k_rule.source, `punctuation.${s_scope_frag}.SIDE.SYNTAX`), {
					symbol: s_symbol,
					side: s_side,
					syntax: h_env.syntax,
				}),
			}))
			.export(),
	});

	// add lookahead to context
	k_context.lookaheads.push({
		regex: g_symbol[s_which],
	});
};

const create_mask = (k_context, g_source) => {
	let s_mask = g_source.mask;

	// no mask
	if(!s_mask) return null;

	// delete mask from source
	delete g_source.mask;

	// create mask context
	let s_context_mask = plug(s_mask, {
		syntax: k_context.syntax.ext,
	}).replace(/\./g, '_')+'_MASK';

	// create new context
	k_context.syntax.append(s_context_mask, [
		{meta_include_prototype:false},
		{meta_content_scope:s_mask},
		{
			match: /* syntax: sublime-syntax.regex */ `'{{_ANYTHING_LOOKAHEAD}}'`.slice(1, -1),
			pop: true,
		},
	]);

	return s_context_mask;
};

const maskable = (z_states, s_state_mask) => {
	// no mask
	if(!s_state_mask) return z_states;

	// // prep mask
	// let a_mask = [
	// 	{meta_include_prototype:false},
	// 	{meta_content_scope:s_mask},
	// 	{
	// 		match: /* syntax: sublime-syntax.regex */ `'{{_ANYTHING_LOOKAHEAD}}'`.slice(1, -1),
	// 		pop: true,
	// 	},
	// ];

	// string state
	if('string' === typeof z_states) {
		return [s_state_mask, z_states];
	}
	// array of states
	else if(Array.isArray(z_states)) {
		return [s_state_mask, ...z_states];
	}
	// unexpected
	else {
		console.assert(`maskable state argument neither string nor array: '${z_states}'`);
	}
};

const H_ALIASES = {
	// else pop alias
	bail(h_env, k_context, k_rule) {
		// replace source rule from context with else pop
		return k_context.replace(k_rule, {
			include: '_OTHERWISE_POP',
		});
	},

	// throw alias
	throw(h_env, k_context, k_rule) {
		return H_EXTENSIONS.throw(h_env, k_context, k_rule, true);
	},

	// retry alias
	retry(h_env, k_context, k_rule) {
		return H_EXTENSIONS.throw(h_env, k_context, k_rule, false);
	},
};

const H_EXTENSIONS = {
	// apply capitalization permutations of the given word in the appearing context
	word: (...a_args) => H_EXTENSIONS.words(...a_args),

	// array-style of above
	words(h_env, k_context, k_rule, z_words, s_tag='auto') {
		// normalize
		let a_words = 'string' === typeof z_words? [z_words]: z_words;

		// remove source rule from context
		let i_rule = k_context.drop(k_rule);

		// invalid tag
		if(['auto', 'mixed', 'camel'].includes(s_tag)) {
			throw new Error(`invalid word tag '${s_tag}'`);
		}

		// each keyword
		for(let s_word of a_words) {
			i_rule = insert_word(h_env, k_context, i_rule, k_rule, s_word, s_tag);
		}

		return i_rule;
	},

	// mark next token as invalid and pop
	throw(h_env, k_context, k_rule, b_pop) {
		// replace source rule from context
		return k_context.replace(k_rule, {
			match: /* syntax: sublime-syntax.regex */ `'{{_SOMETHING}}'`.slice(1, -1),
			scope: resolve_scope(k_rule.source, `invalid.illegal.token.expected.${k_context.id}.${h_env.syntax}`),
			...(b_pop? {pop:b_pop}: {}),
		});
	},

	// goto the next context
	goto(h_env, k_context, k_rule, w_context_goto) {
		// solo rule in context; mark as transitive for later
		if(1 === k_context.rules.length) {
			k_context.transitive = w_context_goto;
		}

		// add lookaheads to context
		k_context.lookaheads.push(
			...normalize_dst(w_context_goto)
				.map(s_context => ({
					lookahead: s_context,
				}))
		);

		// ref (and delete iff exists) mask
		let s_state_mask = create_mask(k_context, k_rule.source);

		// replace source rule from context; insert jump
		return k_context.replace(k_rule, {
			match: /* syntax: sublime-syntax.regex */ `'{{_ANYTHING_LOOKAHEAD}}'`.slice(1, -1),
			set: maskable(w_context_goto, s_state_mask),
		});
	},

	// include multiple contexts and import their lookaheads
	includes(h_env, k_context, k_rule, a_includes) {
		// drop rule
		let i_rule = k_context.drop(k_rule);

		// each list item
		for(let s_include of a_includes) {
			// insert rule
			k_context.insert(i_rule++, {
				include: s_include,
			});

			// add lookahead to context
			k_context.lookaheads.push({
				lookahead: s_include,
			});
		}

		return i_rule;
	},


	// for this rule only, push a scope mask at the bottom of the stack for each action
	mask(h_env, k_context, k_rule, s_scope) {
		let g_source = k_rule.source;

		// ref action
		let s_action = g_source.set? 'set': (g_source.push? 'push': null);

		// no action
		if(!s_action) {
			throw new Error(`'mask' used on ${k_context.id} context but no stack actions found in rule`);
		}

		// coerce to array
		if(!Array.isArray(g_source[s_action])) g_source[s_action] = [g_source[s_action]];

		// mask
		let s_state_mask = create_mask(k_context, k_rule.source);

		// // create new context
		// k_context.def.append(s_context_meta, [
		// 	{meta_include_prototype:false},
		// 	{meta_content_scope:s_meta_scope},
		// 	{
		// 		match: /* syntax: sublime-syntax.regex */ `'{{_ANYTHING_LOOKAHEAD}}'`.slice(1, -1),
		// 		pop: true,
		// 	},
		// ]);

		// push to 'bottom' of stack
		g_source[s_action].unshift(s_state_mask);

		// // push new state to bottom of stack
		// g_source[s_action].unshift([
		// 	{meta_include_prototype:false},
		// 	{meta_content_scope:s_scope},
		// 	{
		// 		match: /* syntax: sublime-syntax.regex */ `'{{_ANYTHING_LOOKAHEAD}}'`.slice(1, -1),
		// 		pop: true,
		// 	},
		// ]);
	},

	open(h_env, k_context, k_rule, s_scope_frag, s_symbol=null) {
		return insert_symbol(h_env, k_context, k_rule, s_scope_frag, s_symbol, 'open', 'begin');
	},

	close(h_env, k_context, k_rule, s_scope_frag, s_symbol=null) {
		return insert_symbol(h_env, k_context, k_rule, s_scope_frag, s_symbol, 'close', 'end');
	},

	switch(h_env, k_context, k_rule, a_cases, s_action='set') {
		// remove source rule from context
		let i_rule = k_context.drop(k_rule);

		// invalid action
		if(!['set', 'push'].includes(s_action)) {
			throw new Error(`invalid switch action '${s_action}'`);
		}

		// ref (and delete iff exists) mask
		let s_state_mask = create_mask(k_context, k_rule.source);

		// each case
		for(let z_case of a_cases) {
			// string
			if('string' === typeof z_case) {
				// cast to string
				let s_case = z_case;

				// insert rule
				k_context.insert(i_rule++, {
					match: /* syntax: sublime-syntax.regex */ `'{{${s_case}_LOOKAHEAD}}'`.slice(1, -1),
					[s_action]: maskable(s_case, s_state_mask),
				});

				// add lookahead to context
				k_context.lookaheads.push({
					lookahead: s_case,
				});
			}
			// object
			else if('object' === typeof z_case) {
				// cast to object
				let h_case = z_case;

				// 0th key
				let s_token = Object.keys(h_case)[0];

				// insert rule
				k_context.insert(i_rule++, {
					match: /* syntax: sublime-syntax.regex */ `'{{${s_token}_LOOKAHEAD}}'`.slice(1, -1),
					[s_action]: maskable(h_case[s_token], s_state_mask),
				});

				// add lookahead to context
				k_context.lookaheads.push({
					lookahead: s_token,
				});
			}
			// other?
			else {
				throw new TypeError(`unexpected type for switch case: ${z_case}`);
			}
		}

		return i_rule;
	},


	// adds scope(s)
	add(h_env, k_context, k_rule, z_add) {
		// ref source
		let g_source = k_rule.source;

		// cast to string (default)
		let s_add = z_add;

		// convert array
		if(Array.isArray(z_add)) {
			s_add = z_add.join(' ');
		}
		// invalid type
		else if('string' !== typeof z_add) {
			throw new Error(`invalid value type given for add: '${z_add}'`);
		}

		// extend scope
		g_source.scope = `${g_source.scope? g_source.scope+' ': ''}${s_add}`;
	},

	// mine lookaheads
	match(h_env, k_context, k_rule, s_regex) {
		// keep match
		k_rule.source.match = s_regex;

		// add lookahead to context
		k_context.lookaheads.push({
			regex: s_regex,
		});
	},
};

const H_QUANTIFIERS = {
	// existential
	'?'(h_env, k_syntax, s_state) {
		let s_state_existential = `${s_state}?`;

		// state not yet exists; add it
		if(!(s_state_existential in k_syntax.contexts)) {
			let k_context = k_syntax.append(s_state_existential, [
				{
					include: s_state,
				},
				{
					include: '_OTHERWISE_POP',
				},
			]);

			// add lookaheads to context
			k_context.lookaheads = [...k_syntax.contexts[s_state].lookaheads];
		}
	},

	// zero or more
	'*'(h_env, k_syntax, s_state) {
		let s_state_zero_more = `${s_state}*`;

		// state not yet exists; add it
		if(!(s_state_zero_more in k_syntax.contexts)) {
			let k_context = k_syntax.append(s_state_zero_more, [
				// {
				// 	match: `${s_state}_LOOKAHEAD`,
				// 	push: s_state,
				// },
				{
					include: s_state,
				},
				{
					include: '_OTHERWISE_POP',
				},
			]);

			// add lookaheads to context
			k_context.lookaheads = [...k_syntax.contexts[s_state].lookaheads];
		}
	},

	// throw (one)
	'^'(h_env, k_syntax, s_state) {
		let s_state_throw = `${s_state}^`;

		// state not yet exists; add it
		if(!(s_state_throw in k_syntax.contexts)) {
			let k_context = k_syntax.append(s_state_throw, [
				{
					include: s_state,
				},
				rule_throw(h_env, s_state, true),
			]);

			// add lookaheads to context
			k_context.lookaheads = [...k_syntax.contexts[s_state].lookaheads];
		}
	},

	// one or more
	'+'(h_env, k_syntax, s_state) {
		let s_state_one_more = `${s_state}+`;
		let s_state_zero_more = `${s_state}*`;
		let s_state_throw = `${s_state}^`;

		// state not yet exists; add it
		if(!(s_state_one_more in k_syntax.contexts)) {
			let k_context = k_syntax.append(s_state_one_more, [
				{
					match: `${s_state}_LOOKAHEAD`,
					set: [
						s_state_zero_more,
						s_state_throw,
					],
				},
				rule_throw(h_env, s_state, true),
			]);

			// add lookaheads to context
			k_context.lookaheads = [...k_syntax.contexts[s_state].lookaheads];
		}

		// star quantifier doesn't exist yet
		if(!(s_state_zero_more in k_syntax.contexts)) {
			H_QUANTIFIERS['*'](h_env, k_syntax, s_state);
		}

		// tg=hrow quantifier doesn't exist yet
		if(!(s_state_throw in k_syntax.contexts)) {
			H_QUANTIFIERS['^'](h_env, k_syntax, s_state);
		}
	},
};


module.exports = (k_syntax, h_env={}) => {
	// set env syntax
	let s_syntax = h_env.syntax = k_syntax.ext;

	// key extensions
	{
		// cache rules
		let a_rules = [...k_syntax.rules()];

		// each rule in syntax
		for(let [k_rule, k_context] of a_rules) {
			// ref rule source
			let z_source = k_rule.source;

			// string
			if('string' === typeof z_source) {
				let s_source = z_source;

				// alias; apply transform
				if(s_source in H_ALIASES) {
					H_ALIASES[s_source](h_env, k_context, k_rule);
				}
				// // not defined
				// else {

				// }
			}
			// object
			else if('object' === typeof z_source) {
				let g_source = z_source;

				// each rule source
				for(let s_key in g_source) {
					// match key
					let [, s_extension, s_modifiers] = R_KEY_EXTENSION.exec(s_key);

					// extension exists
					if(s_extension in H_EXTENSIONS) {
						// fetch value from source
						let w_value = g_source[s_key];

						// delete from object in case it is cloned for rule
						delete g_source[s_key];

						// apply transform
						H_EXTENSIONS[s_extension](h_env, k_context, k_rule, w_value, s_modifiers);
					}
				}
			}
		}
	}


	// context quantifiers
	{
		// each subrule in context
		for(let [k_rule] of k_syntax.rules()) {
			// each state
			for(let s_state of k_rule.states()) {
				// state name has quantifier
				let m_quantifier = R_QUANTIFIER.exec(s_state);
				if(m_quantifier) {
					let [, s_state_src, s_quantifier] = m_quantifier;

					// apply quantifier
					H_QUANTIFIERS[s_quantifier](h_env, k_syntax, s_state_src);
				}
			}
		}
	}



	// placeholders
	{
		// cache rules
		let a_rules = [...k_syntax.rules()];

		// each rule (again)
		for(let [k_rule] of a_rules) {
			// replace placeholders
			k_rule.scopes(s_scope => plug(s_scope, {syntax:s_syntax}));
		}
	}


	// resolve
	return resolve(k_syntax);
};
