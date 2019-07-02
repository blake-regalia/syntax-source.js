
# Syntax Source

Generate high-resolution and _complete_ syntax definitions for languages by feeding this API a set of YAML input files that mimic and extend the [Sublime Text 3 Syntax Definition Schema](https://www.sublimetext.com/docs/3/syntax.html).

## Examples
 - [linked-data.syntaxes](https://github.com/blake-regalia/linked-data.syntaxes/tree/master/src/syntax)

## API Documentation

_Example build script:_
```js
#!/usr/bin/env node
const syntax_source = require('syntax-source');
const export_sublime_syntax = syntax_source.export['sublime-syntax'];

(async() => {
	// load syntax source from a path string
	let k_syntax = await syntax_source.transform({
		path: process.argv[2],

		// optional custom exstensions
		extensions: {
			_customKey: (k_context, k_rule, s_version) => {
				let s_ext = k_context.syntax.ext;

				// remove source rule from context
				let i_rule = k_context.drop(k_rule);

				// create new rule
				k_context.insert(i_rule++, {
					match: `(myCustomRegex)(:)`,
					captures: [
						`keyword.other.word.my-custom-regex.SYNTAX`,
						`punctuation.separator.custom.colon.SYNTAX`,
					],
					pop: true,
				});

				return i_rule;
			},
		},
	});

	// write to stdout
	process.stdout.write(export_sublime_syntax(k_syntax, {
		// optional post-processing transform
		post: g_yaml => ({
			...g_yaml,
			name: `${g_yaml.name} (MyPackage)`,
		}),
	}));
})().catch((e_compile) => {
	console.error(e_compile.stack);
	process.exit(1);
});
```


## Documentation for Input Files
The input files closely follow the `.sublime-syntax` format (an extension of YAML), but the extension should be `.syntax-source` so the highlighting works and so that Sublime Text 3 does not try loading the source files as syntax definitions.

### Primer
This API operates under the assumption that every context intends to match the full range of tokens expected at that state in the grammar. If none of the rules in a given context are matched by the input, an implcitly generated 'catch-all' rule at the end will mark the text invalid (via the `invalid.illega.token.expected.CONTEXT.SYNTAX` scope) and pop the context from the stack (equivalent to the [`throw`](#alias.throw) alias)


### Top Level Key Extensions
In addition to the regular `name`, `file_extensions`, `scope`, etc., you can also use the following keys at the root of the definition structure:

 - `extends` : `filename` - inherit all the variables and contexts defined in the given `.syntax-source`, overriding any duplicate keys.


### Context Quantifiers
When using the `set` or `push` actions, you can essentially quantify a context (which creates a new ad-hoc context) by appending one of the following characters to the target name:

 - `?` - existential quantifier: include the given context and then pop if none of its rules matched.
 - `*` - zero or more quantifier: if the context's lookahead matches, repeatedly push it to the stack until it matches no more; then/otherwise pop.
 - `^` - exactly one quantifier: will throw if the given context does not match.
 - `+` - one or more quantifier: essentially same as `- goto: [CONTEXT*, CONTEXT^]`



### Global Substitutions
Anytime the following placeholder text appears in a scope name, it will be automatically substituted:

 - `SYNTAX` - the syntax id (without the `scope.`/`text.`/`markup.` prefix)


### Rule Aliases
Instead of providing a mapping value for each item in the content of a context, you can use a rule alias to shortcut common patterns. The value must be a single string given by one of the following values:

<a name="alias.alone" />

#### `alone`
Declare this context stands alone, i.e., it does not inherit the prototype context.
Equivalent to:
```yaml
 - meta_include_prototype: false
```

<a name="alias.bail" />

#### `bail`
If none of the previous rules match, pop this context from the stack.
Equivalent to:
```yaml
 - include: _OTHERWISE_POP
```

<a name="alias.throw" />

#### `throw`
If none of the previous rules match, mark the text invalid and pop this context from the stack.
Equivalent to:
```yaml
 - match: '{{_SOMETHING}}'
   scope: invalid.illegal.token.expected.CONTEXT.SYNTAX
   pop: true
```

<a name="alias.retry" />

#### `retry`
If none of the previous rules match, mark the text invalid but do not pop this context from the stack.
Equivalent to:
```yaml
 - match: '{{_SOMETHING}}'
   scope: invalid.illegal.token.expected.CONTEXT.SYNTAX
```


### Key Extensions
Instead of, or in addition to, using the regular `match`, `include`, `push`, `set`, etc., the following keys within the content of a context have the following effects:

<a name="extension.goto" />

#### `goto[.set|push]` : `context | array<context>`
If this rule is reached, it will immediately change state to the given context(s).

*Modifiers:*
 - `.set` - DEFAULT: use the `set` action to change state.
 - `.push` - use the `push` action to change state.

_Example:_
```yaml
contexts:
  main:
    - match: 'hi'
    - goto: [root_MORE, root]

  root:
    - match: 'you'
      scope: keyword.you
    - match: 'world'
      scope: keyword.world
    - goto.push: other

  root_MORE:
    - match: ','
      scope: punctuation.separator
      set: main
```

Using the Sublime Syntax exporter yields:
```yaml
variables:
  _ANYTHING_LOOKAHEAD: '(?=[\S\s])'
contexts:
  main:
    - match: 'hi'
      scope: keyword.hi
    - match: '{{_ANYTHING_LOOKAHEAD}}'
      set: [root_MORE, root]

  root:
    - match: 'you'
      scope: keyword.you
    - match: 'world'
      scope: keyword.world
    - match: '{{_ANYTHING_LOOKAHEAD}}'
      push: other

  root_MORE:
    - match: ','
      scope: punctuation.separator
      set: main
```


<a name="extension.switch" />

#### `switch[.set|push]` : `array<context | mappings>`
Generate a series of rules where each one attempts to match a lookahead regex and consequently change state to the given context.

*Modifiers:*
 - `.set` - DEFAULT: use the `set` action to change state.
 - `.push` - use the `push` action to change state.

_Example:_
```yaml
contexts:
  main:
    - switch:
        - hello
        - world
        - other: world
```

Using the Sublime Syntax exporter yields:
```yaml
variables:
  _ANYTHING_LOOKAHEAD: '(?=[\S\s])'
contexts:
  main:
    - match: '{{hello_LOOKAHEAD}}'
      set: hello
    - match: '{{world_LOOKAHEAD}}'
      set: world
    - match: '{{other_LOOKAHEAD}}'
      set: world
```


<a name="extension.word" />

#### `word[.CASE]` : `text | array<text>`
#### `words[.CASE]` : `text | array<text>`
Generate a series of rules where each one attempts to match a case-sensitive (or insensitive) variation of the given text.

This rule automatically adds the regex `'WORD{{_WORD_BOUNDARY}}'` to the context's lookahead pattern variable, where `WORD` is the supplied text value.

> Keep in mind that these lookaheads will not uselessly bloat your output because any unused variables are automatically removed during compilation, much like dead code removal. You can override the generated lookahead by adding a `- lookahead: 'regex'` rule to the context.

`CASE` *(Modifiers):*
 - `.auto` - DEFAULT: matches the best fit using either `.mixed` or `.camel` depending on the case of the text. If all characters given are lower case, it will use `.mixed`, otherwise it will use `.camel`.
 - `.mixed` - attempts matches the following cases in order: `lower`, `upper`, `proper` or `mixed`.
 - `.camel` - attempts matches the following cases in order: `camel`, `pascal`, `lower`, `upper`, `proper` or `mixed`.
 - `.lower_camel` - will only match `camel`.
 - `.pascal` - will only match `pascal`.
 - `.lower` - will only match `lower`.
 - `.upper` - will only match `upper`.
 - `.exact` - enables case-sensitivity.

<a name="keywords.text.scope-substitutions" />

**Scope Substitutions:**
Scopes attached to this rule may use the following placeholder substitutions:
 - `WORD` - the word that was matched in lower case.
 - `CASE` - will be replaced by one of the following values depending on the text that was matched:
   - `lower` - e.g., strmatches
   - `upper` - e.g., STRMATCHES
   - `proper` - e.g., Strmatches
   - `mixed` - e.g., sTrmAtChEs
   - `camel` - e.g., strMatches
   - `pascal` - e.g., StrMatches
   - `exact` - only if the `.exact` modifier was used

**Optional Keys:**
The generated rule will add the default scope `keyword.operator.word.TYPE.WORD.SYNTAX`, where `TYPE` defaults to *empty* but can be overriden using the `type` key (or the whole scope overriden using the `scope` key -- see below).

The generated rule will also automatically add the supplementary scope `meta.case.CASE.SYNTAX` to the matched text, where `CASE` is given by one the values listed above in [Scope Substitutions](#keywords.text.scope-substitutions).

The following optional keys can be used:
 - `type`: `text` - provides some scope subname to use for `TYPE` in the default scope that is applied. Has no effect if `scope` is used.
 - `scope`: `scope` - overrides the default scope.
 - `boundary`: `regex` - overrides the default boundary lookahead regex ([`_WORD_BOUNDARY`](#support.constant.keyword-boundary)) to match at the end of the keyword.

_Example:_
```yaml
contexts:
  boolean:
    - words:
        - 'true'
        - 'false'
      scope: constant.language.boolean.WORD.SYNTAX
      pop: true
```

Using the Sublime Syntax exporter yields:
```yaml
contexts:
  bolean:
    - match: 'TRUE(?={{_WORD_BOUNDARY}})'
      scope: constant.language.boolean.true.rq meta.case.upper.rq
      pop: true
    - match: 'true(?={{_WORD_BOUNDARY}})'
      scope: constant.language.boolean.true.rq meta.case.lower.rq
      pop: true
    - match: 'True(?={{_WORD_BOUNDARY}})'
      scope: constant.language.boolean.true.rq meta.case.proper.rq
      pop: true
    - match: '(?i)true(?={{_WORD_BOUNDARY}})'
      scope: constant.language.boolean.true.rq meta.case.mixed.rq
      pop: true
    - match: 'FALSE(?={{_WORD_BOUNDARY}})'
      scope: constant.language.boolean.false.rq meta.case.upper.rq
      pop: true
    - match: 'false(?={{_WORD_BOUNDARY}})'
      scope: constant.language.boolean.false.rq meta.case.lower.rq
      pop: true
    - match: 'False(?={{_WORD_BOUNDARY}})'
      scope: constant.language.boolean.false.rq meta.case.proper.rq
      pop: true
    - match: '(?i)false(?={{_WORD_BOUNDARY}})'
      scope: constant.language.boolean.false.rq meta.case.mixed.rq
      pop: true
```


<a name="extension.mask" />

#### `mask` : `scope`
Before changing state, push a context to the stack that will apply the given scope to all contexts put on the stack by some action. This is useful when you want to apply different scopes to a token depending on where it is in the grammar while reusing the same context to match the token itself. Can only be used in combination with a rule that has a `set` or `push` action.

_Example:_
```yaml
contexts:
  predicate:
    - goto: namedNode
      mask: meta.term.role.predicate.SYNTAX

  object:
    - goto: namedNode
      mask: meta.term.role.object.SYNTAX
```

Using the Sublime Syntax exporter yields:
```yaml
contexts:
  predicate:
    - match: '{{_ANYTHING_LOOKAHEAD}}'
      set: [meta_term_role_predicate__MASK, namedNode]

  meta_term_role_predicate__MASK:
    - meta_include_prototype: false
    - meta_content_scope: meta.term.role.predicate.rq
    - match: '{{_ANYTHING_LOOKAHEAD}}'
      pop: true

  object:
    - match: '{{_ANYTHING_LOOKAHEAD}}'
      set: [meta_term_role_object__MASK, namedNode]

  meta_term_role_object__MASK:
    - meta_include_prototype: false
    - meta_content_scope: meta.term.role.object.rq
    - match: '{{_ANYTHING_LOOKAHEAD}}'
      pop: true

```


<a name="extension.add" />

#### `add[.back|front]` : `scope`
Rather than replacing the generated scope, add the given scope to the output either at the `.back` (binds tigther to the token) or at the `.front` (binds looser to the token).


<a name="extension.open" />

#### `open[.SYMBOL]` : `subscope`
#### `close[.SYMBOL]` : `subscope`
Generates a rule that matches either the opening of closing of the given `SYMBOL`, and sets the scope according to the following table.

`SYMBOL` and it's corresponding open/close character, respectively, followed by the scope it applies. `SIDE` is either `begin` or `end` accordingly:
 - `paren` - `(` `)` - `punctuation.definition.SUBSCOPE.SIDE.SYNTAX`
 - `brace` - `{` `}` - `punctuation.section.SUBSCOPE.SIDE.SYNTAX`
 - `bracket` - `[` `]` - `punctuation.definition.SUBSCOPE.SIDE.SYNTAX`
 - `tag` - `<` `>` - `punctuation.definition.SUBSCOPE.SIDE.SYNTAX`
 - `irk` - `'` `'` - `punctuation.definition.string.SIDE.SUBSCOPE.SYNTAX`
 - `dirk` - `"` `"` - `punctuation.definition.string.SIDE.SUBSCOPE.SYNTAX`


