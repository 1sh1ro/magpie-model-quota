# Publishing to magpie's plugin market

magpie discovers plugins by npm package, by a GitHub repository tagged `magpie-plugin`, or by the community list in [`magpie-community/plugins`](https://github.com/magpie-community/plugins) (`registry.json`). All three are optional; npm alone is enough to install by name.

## Before publishing

1. Make sure no personal data is in the tree: no email addresses, account ids, API keys, absolute home paths, or the `~/.config/magpie/model-quota/token` file. The package has none.
2. Pick the npm name. `magpie-model-quota` is used below. If it is taken, publish as `@<your-scope>/magpie-model-quota` and use that in the commands.
3. Replace `<owner>` in `registry-entry.json` and the URLs below with your GitHub account.
4. After the GitHub repository exists, add it to `package.json` so npm links to it and magpie installs from npm:

   ```json
   "repository": { "type": "git", "url": "git+https://github.com/<owner>/magpie-model-quota.git" }
   ```

## GitHub

```sh
git init
git add -A
git -c user.name="magpie-model-quota" -c user.email="<your-github-username>@users.noreply.github.com" commit -m "magpie-model-quota 0.1.0"
gh repo create magpie-model-quota --public --source=. --push --description "Estimate how many tokens each model has left in magpie"
gh repo edit --add-topic magpie-plugin
```

A repository tagged `magpie-plugin` shows up under Plugins → Discover → Unofficial within minutes. Keep `package.json` at the repository root. Commit the files the plugin loads (this package has no build step). This route works without npm: magpie installs the repository as it stands, and users can also run `magpie plugin add github:<owner>/magpie-model-quota`.

Use a neutral commit identity so a personal email is not written into the public history.

## npm

```sh
npm login
npm publish --access public
```

Publish only to the public npm registry (`npm config get registry` must be `https://registry.npmjs.org/`). magpie installs npm packages from the user's own registry, so a package on npm works everywhere.

After publishing, users install it with:

```sh
magpie plugin add magpie-model-quota
```

The Plugins search asks npm for `<query> opencode`. This package's keywords include `opencode` and `opencode-plugin`, so it is found there.

## The community list

The community list installs each entry by its npm package name, so publish to npm first. Without an npm package the entry has nothing to install.

To be suggested in Plugins without searching, open a pull request against [`magpie-community/plugins`](https://github.com/magpie-community/plugins) and add an entry to `registry.json`. `registry-entry.json` in this package is a ready entry:

```json
{
  "package": "magpie-model-quota",
  "kind": "page",
  "name": "Model Quota",
  "icon": "https://raw.githubusercontent.com/<owner>/magpie-model-quota/main/assets/icon.svg",
  "summary": { "en": "…", "zh": "…" }
}
```

`kind: "page"` puts it under Pages. Entries from a package outside the community repository do not carry `"community": true`; they are found by search and show the npm publisher.

## Check the listing locally

Point magpie at a local or custom list and reload Plugins:

```sh
MAGPIE_PLUGIN_MARKET=file:///<absolute-path>/registry.json magpie
```

Or install directly from the package/repository to test exactly what users get:

```sh
magpie plugin add npm:magpie-model-quota
magpie plugin add github:<owner>/magpie-model-quota
```

## Resources

- Docs: <https://usemagpie.ai/docs/plugins>
- Community repository: <https://github.com/magpie-community/plugins>
