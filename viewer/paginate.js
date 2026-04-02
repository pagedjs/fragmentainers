import {
  FragmentainerLayout,
  PageResolver,
  ContentParser,
} from "../src/index.js";

const template = document.createElement("template");
while (document.body.firstChild) {
  template.content.appendChild(document.body.firstChild);
}

const resolver = new PageResolver().fromDocument();
const styles = ContentParser.collectDocumentStyles();

const layout = new FragmentainerLayout(template.content, { resolver, styles });
const flow = await layout.flow();

for (const el of flow.render()) {
  document.body.appendChild(el);
}
