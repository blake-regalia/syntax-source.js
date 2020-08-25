#!/usr/bin/env node
const yargs = require('yargs');
const yaml = require('js-yaml');
const plist = require('plist');
const syntax_source = require('./api.js');

yargs
	.scriptName('syntax-source')

	// convert
	.command('convert', `Convert a document from one format to another; ['yaml', 'json', 'plist']`, {
		from: {
			alias: 'f',
			describe: 'format to convert from',
			demandOption: true,
		},
		to: {
			alias: 't',
			describe: 'format to convert to',
			demandOption: true,
		},
	}, async(g_argv) => {
		// await stdin
		let s_input = '';
		for await(let s_chunk of process.stdin) {
			s_input += s_chunk;
		}

		// destructure options
		const {
			from: s_from,
			to: s_to,
		} = g_argv;

		let g_from = {};
		switch(s_from) {
			case 'yaml': {
				g_from = yaml.safeLoad(s_input, {
					filename: 'stdin',
				});
				break;
			}

			case 'json': {
				g_from = JSON.parse(s_input);
				break;
			}

			case 'plist': {
				g_from = plist.parse(s_input);
				break;
			}

			default: {
				console.error(`Cannot convert from '${s_from}'`);
				process.exit(1);
			}
		}

		switch(s_to) {
			case 'yaml': {
				process.stdout.write(yaml.safeDump(g_from));
				return;
			}

			case 'json': {
				process.stdout.write(JSON.stringify(g_from, null, '\t'));
				return;
			}

			case 'plist': {
				process.stdout.write(plist.build(g_from));
				return;
			}
		}

		console.error(`Cannot convert from '${s_from}' to '${s_to}'`);
	})

	// build
	.command('build <source>', 'Build a syntax highlighting definition given a source file', (y_yargs) => y_yargs
		.positional('source', {
			describe: 'path to the .syntax-source file',
			type: 'string',
		})
		.option('exporter', {
			alias: 'e',
			describe: `which exporter to use; [e.g., 'sublime']`,
		}), async(g_argv) => {
			let s_exporter = g_argv.exporter || 'sublime';

			switch(s_exporter) {
				case 'sublime':
				case 'sublime-syntax':
				case 'sublime_syntax': {
					break;
				}

				default: {
					console.error(`Unknown exporter '${s_exporter}'`);
					process.exit(1);
				}
			}

			const export_syntax = syntax_source.export[s_exporter];

			try {
				// load syntax source from a path string
				let k_syntax = await syntax_source.transform({
					path: g_argv.source,
					extensions: {},
				});

				// write to stdout
				process.stdout.write(export_syntax(k_syntax));
			}
			catch(e_compile) {
				console.error(e_compile.stack);
				process.exit(1);
			}
		})
	.help()
	.argv;
