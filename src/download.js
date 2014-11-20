'use strict';

var fs = require('fs');
var path = require('path');
var File = require('vinyl');
var es = require('event-stream');
var GitHubApi = require('github');
var mkdirp = require('mkdirp');
var request = require('request');
var unzip = require('unzip');

function filter(f) {
	return es.map(function (file, cb) { if (f(file)) cb(null, file); else cb(); });
}

module.exports = function (opts) {
	if (!opts.version) {
		throw new Error('Missing atom-shell option: version.');
	}
	
	if (!opts.platform) {
		throw new Error('Missing atom-shell option: platform.');
	}
	
	if (!opts.cachePath) {
		throw new Error('Missing atom-shell option: cachePath.');
	}
	
	var platform = opts.platform.replace('win32', 'win32-ia32').replace('darwin', 'darwin-x64');
	var assetName = 'atom-shell-v' + opts.version + '-' + platform + '.zip';
	var downloadPath = path.join(opts.cachePath, opts.version, assetName);
	
	var result = es.readable(function (count, callback) {
		var that = this;
		
		function done() {
			fs.createReadStream(downloadPath)
				.pipe(unzip.Parse())
				.on('entry', function (entry) {
					var parts = [];
					entry
						.pipe(es.through(function (part) { parts.push(part); }))
						.on('error', function (err) { callback(err); })
						.on('end', function (err) {
							that.emit('data', new File({
								cwd: '.',
								base: '',
								path: entry.path,
								contents: Buffer.concat(parts)
							}));
						});
				})
				.on('error', function (err) { callback(err); })
				.on('close', function () { that.emit('end'); });
		}
		
		fs.exists(downloadPath, function (exists) {
			if (exists) {
				return done();
			}
			
			var github = new GitHubApi({ version: '3.0.0' });
			github.releases.listReleases({
				owner: 'atom',
				repo: 'atom-shell'
			}, function (err, releases) {
				if (err) { return callback(err); }
				
				var release = releases.filter(function (r) { return r.tag_name === 'v' + opts.version })[0];
				
				if (!release) {
					callback(new Error('Atom-shell release ' + opts.version + ' not found.'));
					return;
				}
				
				var asset = release.assets.filter(function (a) { return assetName === a.name; })[0];
				
				if (!asset) {
					callback(new Error('Atom-shell asset not found for platform ' + opts.platform + ', version v' + opts.version));
					return;
				}
				
				mkdirp(path.dirname(downloadPath), function (err) {
					if (err) { return callback(err); }
					
					var req = request(asset.browser_download_url);
					req.on('end', done);
					req.pipe(fs.createWriteStream(downloadPath));
				});
			});
		});
	});
	
	if (opts.excludeDefaultApp) {
		if (opts.platform === 'win32') {
			result = result.pipe(filter(function (file) { return !/^resources\/default_app/.test(file.path); }));
		} else if (opts.platform === 'darwin') {
			result = result.pipe(filter(function (file) { return !/^Atom.app\/Contents\/Resources\/default_app/.test(file.path); }));
		}
	}
	
	return result;
};
