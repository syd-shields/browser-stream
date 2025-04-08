export interface BaseEvent {
    timestamp: number; //ms
    type: string;
    metadata?: Record<string, any>;
}
export type CDPDomain = 'Page' | 'Network' | 'DOM' | 'Runtime' | 'Console';
export interface BrowserEvent extends BaseEvent {
    type: 'browser';
    browserbaseSessionId?: string;
    domain: CDPDomain;
    /**
     * The full CDP method name (e.g., 'Page.loadEventFired', 'DOM.documentUpdated')
     */
    method: string;
    /**
     * The parameters associated with this event
     */
    params: any;
}
export enum DomInteractionType {
    CLICK = 'click',
    FOCUS = 'focus',
    BLUR = 'blur',
    INPUT = 'input',
    CHANGE = 'change',
    MOUSEDOWN = 'mousedown',
    MOUSEUP = 'mouseup',
    TOUCHSTART = 'touchstart',
    TOUCHEND = 'touchend',
}
export interface ElementRect {
    /**
     * Distance from the top of the viewport
     */
    top: number;

    /**
     * Distance from the right of the viewport
     */
    right: number;

    /**
     * Distance from the bottom of the viewport
     */
    bottom: number;

    /**
     * Distance from the left of the viewport
     */
    left: number;

    /**
     * Width of the element
     */
    width: number;

    /**
     * Height of the element
     */
    height: number;

    /**
     * X coordinate of the element's top-left corner
     */
    x: number;

    /**
     * Y coordinate of the element's top-left corner
     */
    y: number;
}
export interface ElementAttribute {
    /**
     * Name of the attribute
     */
    name: string;

    /**
     * Value of the attribute
     */
    value: string;
}
export interface ElementDetails {
    /**
     * HTML tag name (uppercase)
     */
    tagName: string;

    /**
     * Element ID attribute value
     */
    id: string;

    /**
     * Element class attribute value
     */
    className: string;

    /**
     * Input type (for input elements)
     */
    type: string | null;

    /**
     * Current value (for form elements)
     */
    value: string | null;

    /**
     * Whether the element is checked (for checkboxes and radio buttons)
     */
    checked?: boolean;

    /**
     * Placeholder text (for input elements)
     */
    placeholder?: string;

    /**
     * Name attribute (for form elements)
     */
    name?: string;

    /**
     * Whether the element is contentEditable
     */
    isContentEditable: boolean;

    /**
     * Whether the element is visible
     */
    isVisible: boolean;

    /**
     * Whether the element is disabled
     */
    isDisabled: boolean;

    /**
     * Whether the element is read-only
     */
    isReadOnly: boolean;

    /**
     * List of all element attributes
     */
    attributes: ElementAttribute[];

    /**
     * Position and dimensions of the element
     */
    rect: ElementRect;
}
export interface DomInteractionEventData {
    /**
     * Type of interaction
     */
    type: DomInteractionType | string;

    /**
     * Detailed information about the element
     */
    element: ElementDetails;

    /**
     * Timestamp of the interaction
     */
    timestamp: number;

    /**
     * Current value (for input and change events)
     */
    value?: string;

    /**
     * Current checked state (for checkbox and radio inputs)
     */
    checked?: boolean;

    /**
     * Additional event-specific data
     */
    eventData?: Record<string, any>;
}
