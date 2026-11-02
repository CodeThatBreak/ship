import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { harden } from "rehype-harden";
import { defaultRehypePlugins } from "streamdown";
import type { PluggableList } from "unified";

const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: "",
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "tel", "streamdown"],
    src: [...(defaultSchema.protocols?.src ?? []), "streamdown"],
  },
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "metastring"],
  },
};

/** Agent/plan markdown: no automatic remote image loads (CR-154). */
export const markdownRehypePlugins: PluggableList = [
  defaultRehypePlugins.raw,
  [rehypeSanitize, sanitizeSchema],
  [
    harden,
    {
      allowedImagePrefixes: [],
      allowedLinkPrefixes: ["*"],
      allowedProtocols: ["https", "mailto"],
      allowDataImages: false,
    },
  ],
];
