
module.exports = {
	tasks: {
		all: 'build/**',
	},

	outputs: {
		build: {
			'syntax-source.sublime-syntax': () => ({
				deps: [
					'scrap/debug.js',
					'src/sublime/syntax-source.syntax-source',
					'src/class/*',
					'src/main/*',
				],
				run: /* syntax: bash */ `
					node $1 $2 > $@
				`,
			}),
		},
	},
};
