const SyntaxSource = require('../class/syntax-source.js');
const transform = require('../main/transform.js');
const export_sublime_syntax = require('../export/sublime-syntax.js');

let g_self = module.exports = {
	// load a syntax source file
	async load(g_source={}) {
		// path was given; load from path
		if(g_source.path) {
			return await SyntaxSource.from_path(g_source.path, {
				cwd: g_source.cwd || g_source.pwd || process.cwd(),
			});
		}
		// nothing
		else {
			throw new Error(`source descriptor lacks required keys`);
		}
	},

	// load and transform a syntax source file
	async transform(gc_transform) {
		return transform(await g_self.load(gc_transform), gc_transform);
	},

	// exporters
	export: {
		'sublime-syntax'(...a_args) {
			return export_sublime_syntax(...a_args);
		},
	},

	string_to_regex: s => s.replace(/([.|?*+[\](){}\\^$])/g, '\\$1'),
};
