import './prism/prism.js';          // Defines the Prism object
import './prism/prism-sql.min.js';  // Defines tokens for SQL langauge

// Plugins
import { registerKeyboardShortcuts, indentLine } from './js/keyboard.js';
import { registerLineNumbers, updateLineNumbersHeight } from './js/line-number.js';
import { registerScrollbars } from './js/scrollbar.js';

// Styles
import defaultStyles from './styles/default.js';
import scrollbarStyles from './styles/scrollbar.js';
import lineNumberStyles from './styles/line-number.js';

// Themes
import moondustTheme from './themes/moondust.js';
import invasionTheme from './themes/invasion.js';

/**
 * TODO:
 * - Update the keyboard actions calling to pass in `this` as the first argument and remove unnecessary parameters
 * - Rename some of the divs such as `outer-container`, `container`, `code-container`, etc.
 * - Can we get rid of `widthMeasure` and instead use the `editor` element to measure the width?
 * - Width is not properly calculating leaving horizontal scrolling when no long text exists
 * - Rename scrollbar to be horizontalScrollbar
 * - Add support for database schema syntax highlighting
 */

var templateEditor = document.createElement("template");
templateEditor.innerHTML = `
<div id="outer-container">
    <div id="container" class="moondust dark">
        <!-- The line number container to draw a new number for each line -->
        <div id="line-number-container">
            <div>1</div>
        </div>

        <div id="code-container">
            <!-- The div is used to highlight the active line -->
            <div class="background-highlight"></div>

            <!-- The textarea is used to capture user input -->
            <textarea class="editor" spellcheck="false"></textarea>

            <!-- The code element is used to display the syntax highlighted code -->
            <pre><code></code></pre>

            <!-- The span is used to measure the width of the textarea's content -->
            <span class="width-measure"></span>
        </div>
    </div>

    <div id="scrollbar-bottom">
        <div id="scrollbar-bottom-thumb"></div>
    </div>
</div>
`;

export class OuterbaseEditorLite extends HTMLElement {
    // The DOM element of the outer parent container
    outerContainer = null;
    // The DOM element of the parent container
    container = null;
    //
    codeContainer = null;
    // The DOM element of the scrollbar
    scrollbarBottom = null;
    // The DOM element of the scrollbar thumb
    scrollbarBottomThumb = null;
    // The text to display in the editor
    code = "";
    // The DOM element of the textarea
    editor = null;
    // The DOM element where the syntax highlighted code is displayed
    visualizer = null;
    // The DOM element used to measure the width of the textarea's content
    widthMeasure = null;
    // TODO: Needs to be implemented
    schema = {}

    static get observedAttributes() {
        return [
            // The text to display in the editor
            "code",
            // The code language to use for syntax highlighting
            "language",
            // The theme to use for syntax highlighting, such as "Moondust"
            "theme",
            // The secondary theme for light/dark mode, "light" or "dark"
            "mode",
            // The height of the editors parent container
            "height",
            // The database schema to use for syntax highlighting
            "schema",
        ];
    }

    constructor() {
        super();

        // Default web component setup
        this.shadow = this.attachShadow({ mode: "open" });
        this.shadowRoot.innerHTML = templateEditor.innerHTML;

        // Preserve the references to the textarea and code elements
        this.outerContainer = this.shadow.getElementById("outer-container");
        this.container = this.shadow.getElementById("container");
        this.codeContainer = this.shadow.getElementById("code-container");
        this.scrollbarBottom = this.shadow.getElementById("scrollbar-bottom");
        this.scrollbarBottomThumb = this.shadow.getElementById("scrollbar-bottom-thumb");
        this.editor = this.shadow.querySelector(".editor");
        this.visualizer = this.shadow.querySelector("code");
        this.widthMeasure = this.shadow.querySelector(".width-measure");

        // Import the required styles for the editor
        const styleSheet = new CSSStyleSheet();
        styleSheet.replaceSync(defaultStyles);

        const styleScrollbar = new CSSStyleSheet();
        styleScrollbar.replaceSync(scrollbarStyles);

        const styleLineNumber = new CSSStyleSheet();
        styleLineNumber.replaceSync(lineNumberStyles);

        // Import the supported themes
        const styleMoondust = new CSSStyleSheet();
        styleMoondust.replaceSync(moondustTheme);

        const styleInvasion = new CSSStyleSheet();
        styleInvasion.replaceSync(invasionTheme);

        // Apply the styles to the shadow DOM
        this.shadow.adoptedStyleSheets = [styleSheet, styleScrollbar, styleLineNumber, styleMoondust, styleInvasion];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === "code") {
            this.editor.value = newValue;
            this.updateLineNumbers();
            
            // This timeout is necessary to ensure that the syntax highlighting is applied
            // after the web component has initially rendered after code was made available.
            setTimeout(() => {
                this.render(["syntax"]);
            }, 0);
        }

        if (name === "language") {
            this.visualizer.className = `language-${newValue}`;
        }

        if (name === "theme") {
            this.outerContainer.className = newValue;
        }

        if (name === "mode") {
            this.container.className = newValue;
        }
    }

    connectedCallback() {
        // Keyboard shortcuts, see `keyboard-actions.js` for details
        registerKeyboardShortcuts(
            this.editor,
            this.container,
            this.codeContainer,
            this.visualizer,
            this.getAttribute("language"),
            () => this.render(["syntax"]),
            () => this.updateLineNumbers(),
            () => this.render(["line"]),
            () => this.render(["syntax"]),
            (direction) => indentLine(this, direction),
            (event) => this.dispatchEvent(event)
        );

        this.editor.addEventListener("mousedown", (e) => {
            requestAnimationFrame(() => {
                this.render(["line"]);
            });
        });

        this.editor.addEventListener('focus', () => {
            const backgroundHighlight = this.shadow.querySelector('.background-highlight');
            backgroundHighlight.style.opacity = 1;
        });

        this.editor.addEventListener('blur', () => {
            const backgroundHighlight = this.shadow.querySelector('.background-highlight');
            backgroundHighlight.style.opacity = 0;
        });

        // Initial adjustment in case of any pre-filled content
        this.render(["syntax"]);

        // Register all plugins
        registerScrollbars(this);
        registerLineNumbers(this);
    }

    /**
     * Controls the rendering updates for the various components of the editor.
     * @param {*} options - An array of options to render updates for, such as `line` or `syntax`
     */
    render(options) {
        // If `options` contains `line`, then we need to highlight the active line
        if (options.includes("line")) {
            this.highlightActiveLine();
            this.highlightActiveLineNumber();
        }

        // If `options` contains `syntax`, then we need to redraw the syntax highlighting
        // related parts to the code editor
        if (options.includes("syntax")) {
            this.redrawSyntaxHighlighting();
            this.adjustTextAreaSize();
        }
    }

    adjustTextAreaSize() {
        // Height is number of lines * line height
        const lineHeight = parseFloat(getComputedStyle(this.editor).lineHeight);
        const lineCount = this.editor.value.split("\n").length;
        const height = lineCount * lineHeight;

        // Set height of elements based on contents
        updateLineNumbersHeight(this, height);
        this.editor.style.height = `${height}px`;
    
        // Set width of elements based on contents
        this.widthMeasure.textContent = this.editor.value || this.editor.placeholder;
        this.editor.style.width = Math.max(this.widthMeasure.offsetWidth + 1, this.editor.scrollWidth) + 'px';    
        this.shadow.querySelector(".background-highlight").style.width = this.editor.style.width;
    }

    updateLineNumbers() {
        const lineCount = this.editor.value.split("\n").length;
        const lineNumberContainer = this.shadow.getElementById("line-number-container");
        lineNumberContainer.innerHTML = ''; // Clear existing line numbers
    
        for (let i = 1; i <= lineCount; i++) {
            const lineNumberDiv = document.createElement("div");
            lineNumberDiv.textContent = i;
            lineNumberContainer.appendChild(lineNumberDiv);
        }

        this.render(["line"]);
    }

    highlightActiveLine() {
        const lineHeight = parseFloat(getComputedStyle(this.editor).lineHeight);
        const lineNumber = this.editor.value.substr(0, this.editor.selectionStart).split("\n").length;
        const highlightPosition = (lineNumber - 1) * lineHeight;
        const backgroundHighlight = this.shadow.querySelector('.background-highlight');
        
        requestAnimationFrame(() => {
            backgroundHighlight.style.top = `${highlightPosition}px`;

            // Animate the `backgroundHighlight` component by scaling up and down
            // to create a smooth transition between active lines
            backgroundHighlight.style.transform = 'scaleY(1.25)';
            setTimeout(() => {
                backgroundHighlight.style.transform = 'scaleY(1)';
            }, 200);
        });
    }

    highlightActiveLineNumber() {
        const lineNumber = this.editor.value.substr(0, this.editor.selectionStart).split("\n").length;
        const lineNumbers = this.shadow.querySelectorAll("#line-number-container div");
    
        // Remove the active class from all line numbers
        lineNumbers.forEach(line => {
            line.classList.remove('active-line-number');
        });
    
        // Add the active class to the current line number
        if (lineNumbers[lineNumber - 1]) {
            lineNumbers[lineNumber - 1].classList.add('active-line-number');
        }
    }

    redrawSyntaxHighlighting() {
        this.visualizer.innerHTML = this.editor.value;
        
        try {
            Prism.highlightElement(this.visualizer);
        } catch (error) { }
    }
}

window.customElements.define("outerbase-editor", OuterbaseEditorLite);