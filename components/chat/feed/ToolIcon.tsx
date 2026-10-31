import {
  FilePenLineIcon,
  FileTextIcon,
  GlobeIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";

/** Icon for a tool-call row, matched from the tool's name. */
export function ToolIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  const Icon = /read|view|cat|open|grep.*file/.test(n)
    ? FileTextIcon
    : /write|edit|create|patch|apply/.test(n)
      ? FilePenLineIcon
      : /shell|bash|exec|run|terminal|command/.test(n)
        ? TerminalIcon
        : /search|grep|find|glob|list/.test(n)
          ? SearchIcon
          : /web|fetch|http|browse|url/.test(n)
            ? GlobeIcon
            : WrenchIcon;
  return <Icon />;
}
