const fs = require('fs').promises;
const path = require('path');

const yaml = require('js-yaml');

const R_KEY_EXTENSION = /^([^.]+)(?:\.(.+))?$/;

const H_TYPES = {
	string: z => 'string' === typeof z,
	tree: z => ('object' === typeof z) && !Array.isArray(z),
	array: z => Array.isArray(z),
};

const H_KEYS_TOP = {
	lookaheads: {
		type: 'tree',
		load(h_yaml, s_modifiers='') {
			let h_lookaheads = this.lookaheads || {};

			// default
			h_yaml = h_yaml || {};

			// ignore case flag
			let b_ignore = s_modifiers.includes('i');

			// each entry
			for(let [si_lookahead, z_value] of Object.entries(h_yaml)) {
				// string (regex); copy to tree
				if('string' === typeof z_value) {
					h_lookaheads[si_lookahead] = {
						regex: z_value,
						ignore: b_ignore,
					};
				}
				// array (union of other lookaheads); copy to tree
				else if(Array.isArray(z_value)) {
					h_lookaheads[si_lookahead] = {
						lookaheads: z_value,
						ignore: b_ignore,
					};
				}
				// invalid
				else {
					throw new Error(`invalid lookahead value '${z_value}' supplied at \`lookaheads${s_modifiers? '.'+s_modifiers: ''} > ${si_lookahead}\``);
				}
			}

			return h_lookaheads;
		},
	},

	variables: {
		type: 'tree',
		load(h_yaml, s_modifiers='') {
			let h_variables = this.variables || {};

			// default
			h_yaml = h_yaml || {};

			// ignore case flag
			let b_ignore = s_modifiers.includes('i');

			// each entry
			for(let [si_variable, z_value] of Object.entries(h_yaml)) {
				// string (regex); copy to tree
				if('string' === typeof z_value) {
					h_variables[si_variable] = {
						regex: z_value,
						ignore: b_ignore,
					};
				}
				// array (union of other variables); copy to ree
				else if(Array.isArray(z_value)) {
					h_variables[si_variable] = {
						variables: z_value,
						ignore: b_ignore,
					};
				}
				// invalid
				else {
					throw new Error(`invalid variable value '${z_value}' supplied at \`variables${s_modifiers? '.'+s_modifiers: ''} > ${si_variable}\``);
				}
			}

			return h_variables;
		},
	},

	contexts: {
		type: 'tree',
		load(h_yaml) {
			let h_contexts = this.contexts || {};

			// default
			h_yaml = h_yaml || {};

			// each entry
			for(let [si_context, z_value] of Object.entries(h_yaml)) {
				// invalid value type
				if(!Array.isArray(z_value)) {
					throw new Error(`expected context value to be array (list of rules) at key '${si_context}'; instead found '${z_value}'`);
				}

				// cast to array
				let a_rules = z_value;

				// create context
				h_contexts[si_context] = new Context(a_rules, si_context, this);
			}

			return h_contexts;
		},
	},

	extends: {
		type: 'string',
	},
};

const H_KEYS_ALLOWED = {
	name: 'string',
	file_extensions: 'array',
	first_line_match: 'string',
	scope: 'string',
	hidden: 'boolean',
};

module.exports = class SyntaxSource {
	// create instance from file path
	static async from_path(p_src_rel, g_load={}) {
		// ref cwd
		let s_cwd = g_load.cwd || process.cwd();

		// resolve path
		let p_src_abs = path.resolve(s_cwd, p_src_rel);

		// load file async
		let s_contents = await fs.readFile(p_src_abs);

		// instantiate syntax source
		let k_syntax = new SyntaxSource(yaml.safeLoad(s_contents), p_src_abs, g_load.options);

		// complete load
		return await k_syntax.load();
	}


	constructor(g_syntax, p_src, g_options={}) {
		let g_other = {};

		// defaults
		Object.assign(this, {
			path: p_src,
			ext: '?',
			other: g_other,
			lookaheads: {},
			variables: {},
			contexts: {},
		});

		// check each key/value
		for(let [s_key_src, z_value] of Object.entries(g_syntax)) {
			// extract key modifier
			let [, s_key, s_modifiers] = R_KEY_EXTENSION.exec(s_key_src);

			// not a top key
			if(!(s_key in H_KEYS_TOP)) {
				// allowed key, or custom keys allowed; save value
				if((s_key in H_KEYS_ALLOWED) || g_options.custom_keys) {
					g_other[s_key] = z_value;
				}
				else {
					throw new Error(`unexpected key '${s_key_src}' in top-level of definition`);
				}

				// next key
				continue;
			}

			// destructure descriptor
			let {
				type: s_type,
				load: f_load=null,
			} = H_KEYS_TOP[s_key];

			// fails type check
			if(!H_TYPES[s_type](z_value)) {
				throw new Error(`the value of '${s_key_src}' should be of type '${s_type}'`);
			}

			// has loader; load to this
			if(f_load) {
				this[s_key] = f_load.apply(this, [z_value, s_modifiers]);
			}
			// no loader and has modifiers
			else if(s_modifiers) {
				throw new Error(`base key '${s_key}' does not allow modifiers; invalid use at '${s_key_src}'`);
			}
			// copy to this
			else {
				this[s_key] = z_value;
			}
		}

		// ext
		if(g_other.scope) {
			this.ext = /\.([^.]+)$/.exec(g_other.scope)[1];
		}
	}

	// load (initialize) the syntax
	async load() {
		// extends super source
		if(this.extends) {
			// load super
			let k_super = this.super = await SyntaxSource.from_path(this.extends, {
				cwd: path.dirname(this.path),
			});

			// inherit and override super
			Object.assign(this, {
				lookaheads: {
					...k_super.lookaheads,
					...this.lookaheads,
				},

				variables: {
					...k_super.variables,
					...this.variables,
				},

				contexts: {
					...Object.entries(k_super.contexts)
						.reduce((h_contexts, [si_context, k_context]) => ({
							...h_contexts,

							// change each context's syntax pointer to `this`
							[si_context]: Object.assign(k_context, {
								syntax: this,
							}),
						}), {}),
					...this.contexts,
				},
			});
		}
		// root syntax
		else {
			// insert default variables and contexts (so that impls can override)
			Object.assign(this, {
				variables: {
					...H_KEYS_TOP.variables.load.apply(this, [{
						_SOMETHING: '\\w+|\\S',
						_ANYTHING_LOOKAHEAD: '(?=[\\S\\s])',
						_WHITESPACE: '\\s+',
						_WORD_BOUNDARY: '[\\s{(\\[<*#$?^/="\'>\\])}]',
					}]),

					...this.variables,
				},

				contexts: {
					...H_KEYS_TOP.contexts.load.apply(this, [{
						_OTHERWISE_POP: [
							{meta_include_prototype:false},
							{match:'{{_ANYTHING_LOOKAHEAD}}', pop:true},
						],

						_WHITESPACE: [
							{meta_include_prototype:false},
							{match:'{{_WHITESPACE}}'},
							{scope:'meta.whitespace.SYNTAX'},
						],
					}]),

					...this.contexts,
				},
			});
		}

		// chain
		return this;
	}

	// append a new context
	append(si_context, a_rules) {
		let h_contexts = this.contexts;
		if(si_context in h_contexts) {
			throw new Error(`context '${si_context}' already exists`);
		}

		// create new context from rule list and append it to hash
		return (h_contexts[si_context] = new Context(a_rules, si_context, this));
	}


	// iterator for all rules contained within syntax
	* rules() {
		for(let k_context of Object.values(this.contexts)) {
			yield* k_context.subrules();
		}
	}

};

class Context {
	static from(a_rules) {
		return new Context(a_rules);
	}

	constructor(a_rules, si_context=null, k_syntax=null) {
		Object.assign(this, {
			id: si_context,
			syntax: k_syntax,
			lookaheads: [],
		});

		this.rules = a_rules.map((w_rule, i_rule) => Rule.from(w_rule, i_rule, this));
	}

	drop(k_rule_drop) {
		let a_rules = this.rules;
		let i_rule = a_rules.indexOf(k_rule_drop);
		a_rules.splice(i_rule, 1);
		return i_rule;
	}

	insert(i_rule, w_rule) {
		this.rules.splice(i_rule, 0, Rule.from(w_rule, i_rule, this));
		return i_rule + 1;
	}

	add(w_rule) {
		let a_rules = this.rules;
		let i_rule = a_rules.length;
		a_rules.push(Rule.from(w_rule, i_rule, this));
		return i_rule;
	}

	// inserts(i_rule, a_rules) {
	// 	this.rules.splice(i_rule, 0, ...a_rules.map(w_rule => Rule.from(w_rule, i_rule, this)));
	// 	return i_rule + a_rules.length;
	// }

	replace(k_rule_rm, w_rule_ins) {
		let i_rule = this.drop(k_rule_rm);
		return this.insert(i_rule, w_rule_ins);
	}

	* subrules() {
		// each rule
		for(let k_rule of this.rules) {
			// yield rule itself
			yield [k_rule, this];

			// yield subrules
			yield* k_rule.subrules();
		}
	}

	export(f_apply) {
		let a_rules = this.rules;
		return a_rules.map(k_rule => k_rule.export(f_apply, a_rules))
			.filter(z_rule => null !== z_rule);
	}
}



const captures_to_map = (a_captures) => {
	let h_map = {};
	for(let i_capture=0; i_capture<a_captures.length; i_capture++) {
		h_map[(i_capture+1)+''] = a_captures[i_capture];
	}
	return h_map;
};


const rule_to_states = (g_rule) => {
	// union of `push`, `set` and `include`
	let z_states = g_rule.push || g_rule.set || g_rule.include;

	// no states
	if(!z_states) return [];

	// coerce to array
	let a_states = Array.isArray(z_states)? z_states: [z_states];

	// map each item to state
	return a_states.reduce((a_out, z_state) => [
		...a_out,
		...('string' === typeof z_state
			? [z_state]
			: rule_to_states(z_state)),
	], []);
};

const rules_to_inclusions = (g_rule) => {
	// `include`
	let z_states = g_rule.include;

	// no states
	if(!z_states) return [];

	// coerce to array
	let a_states = Array.isArray(z_states)? z_states: [z_states];

	// map each item to state
	return a_states.reduce((a_out, z_state) => [
		...a_out,
		...('string' === typeof z_state
			? [z_state]
			: rules_to_inclusions(z_state)),
	], []);
};

class Rule {
	static from(z_rule, i_rule, k_context) {
		if(z_rule instanceof Rule) return z_rule;
		else if(!z_rule) throw new Error(`empty context: '${k_context.id}'`);
		return new Rule(z_rule, i_rule, k_context);
	}

	constructor(g_rule, i_rule, k_context) {
		// helpers
		if(Array.isArray(g_rule.captures)) {
			g_rule.captures = captures_to_map(g_rule.captures);
		}

		Object.assign(this, {
			context: k_context,
			index: i_rule,
			source: g_rule,
		});
	}

	scopes(f_mutate) {
		let g_source = this.source;

		// simple scope defined; transform
		if(g_source.scope) {
			g_source.scope = f_mutate(g_source.scope);
		}
		// meta scope defined; transform
		else if(g_source.meta_scope) {
			g_source.meta_scope = f_mutate(g_source.meta_scope);
		}
		// meta content scope defined; transform
		else if(g_source.meta_content_scope) {
			g_source.meta_content_scope = f_mutate(g_source.meta_content_scope);
		}
		// capture group defined; transform each
		else if(g_source.captures) {
			for(let [si_key, s_scope] of Object.entries(g_source.captures)) {
				g_source.captures[si_key] = f_mutate(s_scope);
			}
		}

		return this;
	}

	// extract sub states
	states() {
		return rule_to_states(this.source);
	}

	// extract all includes
	inclusions() {
		return rules_to_inclusions(this.source);
	}

	clone(i_rule) {
		return new Rule({...this.source}, i_rule, this.context);
	}

	export(f_apply=null, a_rules) {
		let g_export = f_apply? f_apply(this.source, a_rules): this.source;

		if(g_export && g_export.match) {
			return {
				match: g_export.match,
				...g_export,
			};
		}

		return g_export;
	}

	mod(f_mod) {
		this.source = f_mod(this.source);
		return this;
	}

	* subrules() {
		let g_source = this.source;

		let s_stack_mod;
		if(g_source.push) s_stack_mod = 'push';
		else if(g_source.set) s_stack_mod = 'set';

		if(s_stack_mod) {
			let z_stack = g_source[s_stack_mod];
			yield* (new Context(Array.isArray(z_stack)? z_stack: [z_stack], this.context.id+'/'+this.index)).subrules();
		}
	}
}
