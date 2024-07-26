import { EditorState, TextSelection } from "prosemirror-state";
import {
  Node,
  DOMParser as ProseMirrorDOMParser,
  ResolvedPos,
  Schema,
} from "prosemirror-model";
import React, {
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { EditorView } from "prosemirror-view";
import { Equal } from "hsu-utils";
import _ from "lodash";
import { baseKeymap } from "prosemirror-commands";
import classNames from "classnames";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { schema } from "prosemirror-schema-basic";
import styles from "./index.module.less";
import { useDebounceEffect } from "ahooks";

interface JsonContent {
  type: string;
  content: Content2[];
}
interface Content2 {
  type: string;
  content?: Content[];
}
interface Content {
  type: string;
  text: string;
}

interface ProseMirrorProps {
  onChange?: () => void;
  insertHtml?: string;
  defaultNode?: ReactNode;
  reset?: boolean;
  equalInit?: (equal: boolean) => void;
  className?: string;
}

const customSchema = new Schema({
  nodes: {
    ...schema.spec.nodes.toObject(),
    span: {
      inline: true,
      group: "inline",
      content: "inline*",
      attrs: { style: { default: "" }, class: { default: "" } },
      parseDOM: [
        {
          tag: "span",
          getAttrs: (dom) => ({
            style: dom.getAttribute("style"),
            class: dom.getAttribute("class"),
          }),
        },
      ],
      toDOM: (node) => [
        "span",
        { style: node.attrs.style, class: node.attrs.class },
        0,
      ],
    },
  },
  marks: schema.spec.marks,
});

const plugins = [
  keymap({
    ...baseKeymap,
    Enter: (state, dispatch, view) => {
      const { from, to, $from } = state.selection;
      const newNode = customSchema.nodes.paragraph.create();

      const node = $from.node();
      let tr = state.tr;
      let newPos = from + 1;

      if (view && dispatch) {
        const curr = IsParagraph(view.state.doc.resolve(from));
        const prev = IsParagraph(
          view.state.doc.resolve((from > 0 ? from : 1) - 1)
        );
        const next = IsParagraph(view.state.doc.resolve(from + 1));

        if (from === to) {
          if (curr) {
            if (from === curr.end()) {
              tr = tr.insert(from, newNode);
            } else {
              tr = tr.split(from);
            }
            newPos = from + 1;
          } else if (prev) {
            tr = tr.split(from - 1, 1, [
              { type: customSchema.nodes.paragraph },
            ]);
            newPos = from;
          } else if (next) {
            if (from + 1 === next.end()) {
              tr = tr.insert(from + 1, newNode);
            } else {
              tr = tr.split(from + 1);
            }
            newPos = from + 2;
          } else {
            return true;
          }
        } else if (node.type.name === "span") {
          return true;
        } else {
          tr = tr.replaceWith(from, to, newNode);
          newPos = from + 1;
        }

        tr = tr.setSelection(TextSelection.near(tr.doc.resolve(newPos)));

        dispatch(tr.scrollIntoView());
        return true;
      }

      return false;
    },
    Space: (state, dispatch, view) => {
      const { from, to } = state.selection;
      const newNode = customSchema.nodes.span.create(
        { class: "custom-blank-hl" },
        [customSchema.text(" ")]
      );

      let tr = state.tr;
      let newPos = from + 1;

      if (view && dispatch) {
        const curr = IsParagraph(view.state.doc.resolve(from));
        const prev = IsParagraph(
          view.state.doc.resolve((from > 0 ? from : 1) - 1)
        );
        const next = IsParagraph(view.state.doc.resolve(from + 1));

        if (curr) {
          tr = view.state.tr.replaceWith(from, to, newNode);

          newPos = from + newNode.nodeSize;
        } else if (prev) {
          tr = view.state.tr.replaceWith(from - 1, to - 1, newNode);

          newPos = from - 1 + newNode.nodeSize;
        } else if (next) {
          tr = view.state.tr.replaceWith(from + 1, to + 1, newNode);

          newPos = from + 1 + newNode.nodeSize;
        }

        tr = tr.setSelection(TextSelection.near(tr.doc.resolve(newPos)));

        view.dispatch(tr.scrollIntoView());

        return true;
      }

      return false;
    },
  }),
  history(),
  dropCursor(),
  gapCursor(),
];

const IsParagraph = ($pos: ResolvedPos) => {
  const node = $pos.node();

  return node && node.type.name === "paragraph" ? $pos : null;
};

const insertHtmlAtCursor = _.throttle(
  (html: string, view: EditorView, pos: number) => {
    const parser = new DOMParser();
    const htmlDocument = parser.parseFromString(html, "text/html");
    const contentElement = htmlDocument.body;

    const spanSlice =
      ProseMirrorDOMParser.fromSchema(customSchema).parseSlice(contentElement);

    const curr = IsParagraph(view.state.doc.resolve(pos));
    const prev = IsParagraph(view.state.doc.resolve((pos > 0 ? pos : 1) - 1));
    const next = IsParagraph(view.state.doc.resolve(pos + 1));

    if (curr) {
      let tr = view.state.tr.replaceRangeWith(
        pos,
        pos,
        spanSlice.content as never as Node
      );

      tr = tr.setSelection(
        TextSelection.near(tr.doc.resolve(pos + spanSlice.content.size))
      );

      view.dispatch(tr.scrollIntoView());
    } else if (prev) {
      let tr = view.state.tr.replaceRangeWith(
        pos - 1,
        pos - 1,
        spanSlice.content as never as Node
      );

      tr = tr.setSelection(
        TextSelection.near(tr.doc.resolve(pos - 1 + spanSlice.content.size))
      );

      view.dispatch(tr.scrollIntoView());
    } else if (next) {
      let tr = view.state.tr.replaceRangeWith(
        pos + 1,
        pos + 1,
        spanSlice.content as never as Node
      );

      tr = tr.setSelection(
        TextSelection.near(tr.doc.resolve(pos + 1 + spanSlice.content.size))
      );

      view.dispatch(tr.scrollIntoView());
    }

    view.dom.focus();
  },
  100
);

const ProseMirror: React.FC<ProseMirrorProps> = (props) => {
  const { insertHtml, defaultNode, reset, equalInit, className } = props;
  const editorRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView>();
  const [pos, setPos] = useState<number>(0);

  useEffect(() => {
    if (insertHtml && view) {
      insertHtmlAtCursor(insertHtml, view, pos);
    }
  }, [insertHtml, pos, view]);

  const handleChange = useCallback(
    (newState: EditorState, initialContent: JsonContent) => {
      const jsonContent: JsonContent = newState.doc.toJSON();

      const { from } = newState.selection;
      setTimeout(() => {
        setPos(from);
      }, 100);

      equalInit?.(Equal.ObjEqual(initialContent, jsonContent));
    },
    [equalInit]
  );

  useEffect(() => {
    const onReset = () => {
      if (!view) return;

      const state = EditorState.create({
        doc: ProseMirrorDOMParser.fromSchema(customSchema).parse(
          document.querySelector("#content") as HTMLDivElement
        ),
        plugins,
      });

      view.updateState(state);

      equalInit?.(true);
    };

    if (reset) {
      onReset();
    }
  }, [equalInit, reset, view]);

  useDebounceEffect(() => {
    if (editorRef.current) {
      const state = EditorState.create({
        doc: ProseMirrorDOMParser.fromSchema(customSchema).parse(
          document.querySelector("#content") as HTMLDivElement
        ),
        plugins,
      });

      const view = new EditorView(editorRef.current, {
        state,
        dispatchTransaction(transaction) {
          const newState = view.state.apply(transaction);
          view.updateState(newState);
          handleChange(newState, state.doc.toJSON());
        },
        handleTextInput(view, from, to, text) {
          const curr = IsParagraph(view.state.doc.resolve(from));
          const prev = IsParagraph(view.state.doc.resolve(from - 1));
          const next = IsParagraph(view.state.doc.resolve(from + 1));

          const textNode = customSchema.text(text);

          if (curr) {
            let tr = view.state.tr.replaceRangeWith(from, to, textNode);

            tr = tr.setSelection(
              TextSelection.near(tr.doc.resolve(from + textNode.nodeSize))
            );

            view.dispatch(tr.scrollIntoView());

            return true;
          } else if (prev) {
            let tr = view.state.tr.replaceRangeWith(from - 1, to - 1, textNode);

            tr = tr.setSelection(
              TextSelection.near(tr.doc.resolve(from - 1 + textNode.nodeSize))
            );

            view.dispatch(tr.scrollIntoView());

            return true;
          } else if (next) {
            let tr = view.state.tr.replaceRangeWith(from + 1, to + 1, textNode);

            tr = tr.setSelection(
              TextSelection.near(tr.doc.resolve(from + 1 + textNode.nodeSize))
            );

            view.dispatch(tr.scrollIntoView());

            return true;
          }

          return false;
        },
      });

      setView(view);

      // 监听点击事件
      const handleClick = (event: MouseEvent) => {
        const pos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (pos) {
          setPos(pos.pos);
        }
      };

      // 在 ProseMirror 的 DOM 元素上添加事件监听器
      view.dom.addEventListener("click", handleClick);

      // 清理事件监听器
      return () => {
        view.dom.removeEventListener("click", handleClick);
      };
    }
  }, []);

  return (
    <div ref={editorRef} className={classNames(styles.proseMirror, className)}>
      <div id="content" style={{ display: "none" }}>
        {defaultNode}
      </div>
    </div>
  );
};

export default ProseMirror;
