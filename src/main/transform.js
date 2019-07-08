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

const rule_throw = (k_syntax, s_state, b_pop=false) => ({
	match: /* syntax: sublime-syntax.regex */ `'{{_SOMETHING}}'`.slice(1, -1),
	scope: `invalid.illegal.token.expected.${s_state}.${k_syntax.ext}`,
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

	// check other keys
	for(let s_key in g_source) {
		// add
		let m_add = /^add(?:\.(\w+))?$/.exec(s_key);
		if(m_add) {
			let [, s_modifiers] = m_add;

			// ref add
			let z_add = g_source[s_key];

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

			// extend scope
			{
				// check modifier
				if(s_modifiers && !['front', 'top', 'back', 'bottom'].includes(s_modifiers)) {
					throw new Error(`invalid add modifier '${s_modifiers}'; must be one of [front, top, back, bottom]`);
				}

				// front
				if('front' === s_modifiers || 'top' === s_modifiers) {
					s_scope = `${s_add}${s_scope? ' '+s_scope: ''}`;
				}
				// back
				else {
					s_scope = `${s_scope? s_scope+' ': ''}${s_add}`;
				}
			}
		}
	}

	return `${s_scope}${s_always? ' '+s_always: ''}`;
};

const insert_word = (k_context, i_rule, k_rule, s_word, s_tag) => {
	let g_source = k_rule.source;

	// lookahead boundary
	let s_boundary = g_source.boundary || '{{_WORD_BOUNDARY}}';

	// eventual lookahead
	let g_lookahead = {
		regex: `${string_to_regex(s_word)}${s_boundary}`,
		ignore: true,
	};

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
			g_lookahead.ignore = false;
		}
		// exact
		else if('exact' === s_tag) {
			h_cases = {exact:s => s};
			g_lookahead.ignore = false;
		}
	}

	// each predefined case
	for(let [s_case, f_case] of Object.entries(h_cases)) {
		let s_action = (g_source.push && 'push') || (g_source.set && 'set');

		// placeholder plug
		let h_plug = {
			case: s_case,
			word: s_word,
		};

		// create permutation to rule
		let g_rule_insert = {
			match: `${f_case(string_to_regex(s_word))}(?=${s_boundary})`,
			...k_rule.clone(i_rule)
				.scopes(s_scope => plug(s_scope, h_plug))
				.export(),

			...(s_action
				? {
					[s_action]: maskable(
						g_source[s_action],
						create_mask(k_context, {...g_source}, h_plug)
					),
				}
				: {}),

			scope: plug(
				resolve_scope(
					g_source,
					`keyword.operator.word.${s_type? s_type+'.': ''}WORD.SYNTAX`,
					'exact' === s_tag? '': `meta.case.CASE.SYNTAX`
				), {
					case: s_case,
					word: s_word,
					syntax: k_context.syntax.ext,
				}),
		};

		// delete special keys
		delete g_rule_insert.boundary;
		delete g_rule_insert.type;
		delete g_rule_insert.mask;

		// insert permutation
		k_context.insert(i_rule++, g_rule_insert);
	}

	// add lookahead to context
	k_context.lookaheads.push(g_lookahead);

	return i_rule;
};

const insert_symbol = (k_context, k_rule, s_scope_frag, s_symbol, s_which, s_side) => {
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
					syntax: k_context.syntax.ext,
				}),
			}))
			.export(),
	});

	// add lookahead to context
	k_context.lookaheads.push({
		regex: g_symbol[s_which],
	});
};

const create_mask = (k_context, g_source, h_plug={}) => {
	let s_mask = g_source.mask;

	// no mask
	if(!s_mask) return null;

	// delete mask from source
	delete g_source.mask;

	// plug scope
	let s_scope = plug(s_mask, {
		syntax: k_context.syntax.ext,
		...h_plug,
	});

	// create mask context
	let s_context_mask = s_scope.replace(/[^\w0-9]/g, '_')+'_MASK';

	// create new context (if it doesn't exist yet)
	if(!(s_context_mask in k_context.syntax.contexts)) {
		k_context.syntax.append(s_context_mask, [
			{
				meta_include_prototype: false,
			},
			{
				meta_content_scope: s_scope,
			},
			{
				match: /* syntax: sublime-syntax.regex */ `'{{_ANYTHING_LOOKAHEAD}}'`.slice(1, -1),
				pop: true,
			},
		]);
	}

	return s_context_mask;
};

const maskable = (z_states, s_state_mask) => {
	// no mask
	if(!s_state_mask) return Array.isArray(z_states)? z_states: [z_states];

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
	bail(k_context, k_rule) {
		// replace source rule from context with else pop
		return k_context.replace(k_rule, {
			include: '_OTHERWISE_POP',
		});
	},

	// throw alias
	throw(k_context, k_rule) {
		return H_EXTENSIONS.throw(k_context, k_rule, true);
	},

	// retry alias
	retry(k_context, k_rule) {
		return H_EXTENSIONS.throw(k_context, k_rule, false);
	},

	// continue alias
	continue(k_context, k_rule) {
		return k_context.replace(k_rule, {
			match: '.',
		});
	},

	// alone alias
	alone(k_context, k_rule) {
		return k_context.replace(k_rule, {
			meta_include_prototype: false,
		});
	},
};

const H_EXTENSIONS = {
	// apply capitalization permutations of the given word in the appearing context
	word: (...a_args) => H_EXTENSIONS.words(...a_args),

	// array-style of above
	words(k_context, k_rule, z_words, s_tag='auto') {
		// normalize
		let a_words = 'string' === typeof z_words? [z_words]: z_words;

		// remove source rule from context
		let i_rule = k_context.drop(k_rule);

		// each keyword
		for(let s_word of a_words) {
			i_rule = insert_word(k_context, i_rule, k_rule, s_word, s_tag);
		}

		return i_rule;
	},

	// mark next token as invalid and pop
	throw(k_context, k_rule, b_pop) {
		// replace source rule from context
		return k_context.replace(k_rule, {
			match: /* syntax: sublime-syntax.regex */ `'{{_SOMETHING}}'`.slice(1, -1),
			scope: resolve_scope(k_rule.source, `invalid.illegal.token.expected.${k_context.id}.${k_context.syntax.ext}`),
			...(b_pop? {pop:b_pop}: {}),
		});
	},

	// goto the next context
	goto(k_context, k_rule, w_context_goto, s_modifiers) {
		// check modifiers
		if(s_modifiers && !['push', 'set'].includes(s_modifiers)) {
			throw new Error(`invalid goto modifier '${s_modifiers}'; must be one of [push, set]`);
		}

		// solo rule in context; mark as transitive for later
		if(1 === k_context.rules.length) {
			k_context.transitive = w_context_goto;
		}

		// add lookahead from top state to context
		k_context.lookaheads.push(
			...normalize_dst(w_context_goto).slice(-1)
				.map(s_context => ({
					lookahead: s_context.replace(/[?*^+]$/, ''),
				}))
		);

		// flush
		let b_flush = k_rule.source.flush;
		if(b_flush) {
			// no flush context yes; append flush context
			if(!('_FLUSH' in k_context.syntax.contexts)) {
				k_context.syntax.append('_FLUSH', [{
					match: '{{_SOMETHING}}',
					scope: `invalid.illegal.unknown.flush.${k_context.syntax.ext}`,
					pop: true,
				}]);
			}
		}

		// ref (and delete iff exists) mask
		let s_state_mask = create_mask(k_context, k_rule.source);

		// replace source rule from context; insert jump
		return k_context.replace(k_rule, {
			match: /* syntax: sublime-syntax.regex */ `'{{_ANYTHING_LOOKAHEAD}}'`.slice(1, -1),
			['push' === s_modifiers? 'push': 'set']: [
				...(b_flush? ['_FLUSH']: []),
				...maskable(w_context_goto, s_state_mask),
			],
		});
	},

	// include multiple contexts and import their lookaheads
	includes(k_context, k_rule, a_includes) {
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
	mask(k_context, k_rule, s_scope) {
		let g_source = k_rule.source;

		// ref action
		let s_action = g_source.set? 'set': (g_source.push? 'push': null);

		// no action
		if(!s_action) {
			throw new Error(`mask used on '${k_context.id}' context but no stack actions found in rule`);
		}

		// coerce to array
		if(!Array.isArray(g_source[s_action])) g_source[s_action] = [g_source[s_action]];

		// create psuedo mask
		let s_state_mask = create_mask(k_context, {...k_rule.source, mask:s_scope});

		// push to 'bottom' of stack
		g_source[s_action] = maskable(g_source[s_action], s_state_mask);
	},

	open(k_context, k_rule, s_scope_frag, s_symbol=null) {
		return insert_symbol(k_context, k_rule, s_scope_frag, s_symbol, 'open', 'begin');
	},

	close(k_context, k_rule, s_scope_frag, s_symbol=null) {
		return insert_symbol(k_context, k_rule, s_scope_frag, s_symbol, 'close', 'end');
	},

	switch(k_context, k_rule, a_cases, s_action='set') {
		// remove source rule from context
		let i_rule = k_context.drop(k_rule);

		// invalid action
		if(!['set', 'push'].includes(s_action)) {
			throw new Error(`in context '${k_context.id}': invalid switch action '${s_action}'`);
		}

		// invalid type
		if(!Array.isArray(a_cases)) {
			throw new Error(`in context '${k_context.id}': invalid switch value type '${a_cases}'; expected sequence (array)`);
		}

		// ref (and delete iff exists) mask
		let s_state_mask = create_mask(k_context, k_rule.source);

		// each case
		for(let z_case of a_cases) {
			// string
			if('string' === typeof z_case) {
				// cast to string
				let s_case = z_case;

				// remove quantifier for lookahead
				let s_state = s_case.replace(/[?*^+]$/, '');

				// insert rule
				k_context.insert(i_rule++, {
					match: /* syntax: sublime-syntax.regex */ `'{{${s_state}_LOOKAHEAD}}'`.slice(1, -1),
					[s_action]: maskable(s_case, s_state_mask),
				});

				// add lookahead to context
				k_context.lookaheads.push({
					lookahead: s_state,
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
				throw new TypeError(`in context '${k_context.id}': unexpected type for switch case: ${z_case}`);
			}
		}

		return i_rule;
	},


	// adds scope(s)
	add(k_context, k_rule, z_add, s_modifiers) {
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
			throw new Error(`in context '${k_context.id}': invalid value type given for add: '${z_add}'`);
		}

		// extend scope
		{
			// check modifier
			if(s_modifiers && !['front', 'top', 'back', 'bottom'].includes(s_modifiers)) {
				throw new Error(`in context '${k_context.id}': invalid add modifier '${s_modifiers}'; must be one of [front, top, back, bottom]`);
			}

			// front
			if('front' === s_modifiers || 'top' === s_modifiers) {
				g_source.scope = `${s_add}${g_source.scope? ' '+g_source.scope: ''}`;
			}
			// back
			else {
				g_source.scope = `${g_source.scope? g_source.scope+' ': ''}${s_add}`;
			}
		}
	},

	// mine lookaheads
	match(k_context, k_rule, s_regex) {
		// keep match
		k_rule.source.match = s_regex;

		// add lookahead to context
		k_context.lookaheads.push({
			regex: s_regex,
		});
	},

	// mine lookaheads
	include(k_context, k_rule, si_context) {
		// keep include
		k_rule.source.include = si_context;

		// add lookahead to context
		k_context.lookaheads.push({
			lookahead: si_context,
		});
	},

	// alias of lookaheads
	lookahead: (...a_args) => H_EXTENSIONS.lookaheads(...a_args),

	// manually set lookahead(s)
	lookaheads(k_context, k_rule, z_lookahead, s_modifiers) {
		// remove rule
		k_context.drop(k_rule);

		// ref context id
		let si_context = k_context.id;

		// ref lookaheads table
		let h_lookaheads = k_context.syntax.lookaheads;

		// anonymous context
		if(!si_context) {
			throw new Error(`cannot define lookahead for anonymous context`);
		}

		// lookahead already defined
		if(h_lookaheads[si_context]) {
			throw new Error(`lookahead key in context cannot override declared lookahead definition '${si_context}_LOOKAHEAD'`);
		}

		let g_lookahead;

		// string (regex)
		if('string' === typeof z_lookahead) {
			g_lookahead = {
				regex: z_lookahead,
			};
		}
		// array (lookahead refs)
		else if(Array.isArray(z_lookahead)) {
			g_lookahead = {
				lookaheads: z_lookahead,
			};
		}
		// invalid type
		else {
			throw new Error(`context '${si_context}' has invalid lookahead value type '${z_lookahead}'`);
		}

		// ignore case
		if('i' === s_modifiers) g_lookahead.ignore = true;

		// add lookahead variable to override any other directives
		h_lookaheads[si_context] = g_lookahead;
	},
};

const H_QUANTIFIERS = {
	// existential
	'?'(k_syntax, s_state) {
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
			// k_context.lookaheads = [...k_syntax.contexts[s_state].lookaheads];
			k_context.lookaheads = [{
				lookaheads: s_state,
			}];
		}
	},

	// zero or more
	'*'(k_syntax, s_state) {
		let s_state_zero_more = `${s_state}*`;
		let s_state_existential = `${s_state}?`;

		// state not yet exists; add it
		if(!(s_state_zero_more in k_syntax.contexts)) {
			let k_context = k_syntax.append(s_state_zero_more, [
				{
					match: `{{${s_state}_LOOKAHEAD}}`,

					// push existential quantifier context that includes the state so resolver does not make it throw
					push: s_state_existential,
				},
				{
					include: '_OTHERWISE_POP',
				},
			]);

			// add lookaheads to context
			// k_context.lookaheads = [...k_syntax.contexts[s_state].lookaheads];
			k_context.lookaheads = [{
				lookaheads: s_state,
			}];
		}

		// existential quantifier doesn't exist yet
		if(!(s_state_existential in k_syntax.contexts)) {
			H_QUANTIFIERS['?'](k_syntax, s_state);
		}
	},

	// throw (one)
	'^'(k_syntax, s_state) {
		let s_state_throw = `${s_state}^`;

		// state not yet exists; add it
		if(!(s_state_throw in k_syntax.contexts)) {
			let k_context = k_syntax.append(s_state_throw, [
				{
					include: s_state,
				},
				rule_throw(k_syntax, s_state, true),
			]);

			// add lookaheads to context
			// k_context.lookaheads = [...k_syntax.contexts[s_state].lookaheads];
			k_context.lookaheads = [{
				lookaheads: s_state,
			}];
		}
	},

	// one or more
	'+'(k_syntax, s_state) {
		let s_state_one_more = `${s_state}+`;
		let s_state_zero_more = `${s_state}*`;
		let s_state_throw = `${s_state}^`;

		// state not yet exists; add it
		if(!(s_state_one_more in k_syntax.contexts)) {
			let k_context = k_syntax.append(s_state_one_more, [
				{
					// match: `{{${s_state}_LOOKAHEAD}}`,
					match: '{{_ANYTHING_LOOKAHEAD}}',
					set: [
						s_state_zero_more,
						s_state_throw,
					],
				},
				// rule_throw(k_syntax, s_state+'+', true),
			]);

			// add lookaheads to context
			// k_context.lookaheads = [...k_syntax.contexts[s_state].lookaheads];
			k_context.lookaheads = [{
				lookaheads: s_state,
			}];
		}

		// star quantifier doesn't exist yet
		if(!(s_state_zero_more in k_syntax.contexts)) {
			H_QUANTIFIERS['*'](k_syntax, s_state);
		}

		// tg=hrow quantifier doesn't exist yet
		if(!(s_state_throw in k_syntax.contexts)) {
			H_QUANTIFIERS['^'](k_syntax, s_state);
		}
	},
};

const apply_extensions = (k_syntax, g_apply={}) => {
	let {
		aliases: h_aliases={},
		extensions: h_extensions={},
	} = g_apply;

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
			if(s_source in h_aliases) {
				h_aliases[s_source](k_context, k_rule);
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
				if(s_extension in h_extensions) {
					// fetch value from source
					let w_value = g_source[s_key];

					// delete from object in case it is cloned for rule
					delete g_source[s_key];

					// apply transform
					h_extensions[s_extension](k_context, k_rule, w_value, s_modifiers);
				}
			}
		}
	}
};

module.exports = (k_syntax, gc_transform={}) => {
	// custom key extensions
	{
		let {
			alias: h_aliases={},
			extensions: h_extensions={},
		} = gc_transform;

		for(let s_alias in h_aliases) {
			if(!s_alias.startsWith('_')) {
				throw new Error(`custom alias must start with '_'; failed on '${s_alias}'`);
			}
		}

		for(let s_extension in h_extensions) {
			if(!s_extension.startsWith('_')) {
				throw new Error(`custom extension must start with '_'; failed on '${s_extension}'`);
			}
		}

		apply_extensions(k_syntax, {
			aliases: h_aliases,
			extensions: h_extensions,
		});
	}


	// built-in key extensions
	{
		apply_extensions(k_syntax, {
			aliases: H_ALIASES,
			extensions: H_EXTENSIONS,
		});
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
					H_QUANTIFIERS[s_quantifier](k_syntax, s_state_src);
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
			k_rule.scopes(s_scope => plug(s_scope, {syntax:k_syntax.ext}));
		}
	}


	// resolve
	return resolve(k_syntax, {
		dangerous: gc_transform.dangerous,
	});
};
