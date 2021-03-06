import React from "react";
import Messenger from "chrome-ext-messenger";
import _ from "lodash";
import { INITIAL_WIDTH } from "./messages";
import { HeaderBar } from "app/components/HeaderBar";
import { PORT_TYPES, MESSAGE_TYPES } from "../lib/port";
import { Button } from "app/components/Button";
import { BUTTON_COLORS } from "../../app/components/Button";
import Dropdown from "../../app/components/Dropdown";
import { Icon } from "../../app/components/Icon";
import { StylesheetCodePreview } from "../../app/components/StylesheetCodePreview";
import CodeDiff, { concatStylesheets } from "../../app/components/CodeDiff";
import filenameify from "filenamify";
import classNames from "classnames";
import injectScriptNames from "../lib/injectScriptNames";

const messenger = new Messenger();

const buildEditURL = gistId => {
  return `${__API_HOST__}/api/gists/edit/${gistId}`;
};

const copyToClipboard = text => {
  const input = document.createElement("input");
  document.body.appendChild(input);
  input.value = text;
  input.focus();
  input.style.visibility = "hidden";
  input.select();
  const result = document.execCommand("copy");

  if (result === "unsuccessful") {
    console.error("Failed to copy text.");
  }

  document.body.removeChild(input);

  return result !== "unsuccessful";
};

class CreateStyleURL extends React.PureComponent {
  state = {
    stylesheets: [],
    downloadURL: null
  };

  static getDerivedStateFromProps(props, state) {
    if (props.stylesheets !== state.stylesheets) {
      if (props.stylesheets) {
        const blob = new Blob([concatStylesheets(props.stylesheets, true)], {
          type: "text/plain;charset=UTF-8"
        });

        return {
          stylesheets: props.stylesheets,
          downloadURL: window.URL.createObjectURL(blob)
        };
      } else {
        if (state.downloadURL) {
          URL.revokeObjectURL(state.downloadURL);
        }

        return { stylesheets: [], downloadURL: null };
      }
    } else {
      return {};
    }
  }

  getFilename = () => {
    // The plus here is just here so the VSCode syntax highlighter doesnt get messed up
    // Weird VSCode bug :shrug:
    return filenameify(`${location.pathname.substr(1)}.diff` + ".css", {
      replacement: "_"
    });
  };

  render() {
    const {
      onToggleDiff,
      onExport,
      onShareChanges,
      stylesheets,
      shareURL,
      setShareLinkRef,
      hidden,
      onHide
    } = this.props;

    return (
      <HeaderBar
        hidden={hidden}
        onHide={onHide}
        center={
          <input
            value={shareURL}
            readOnly
            ref={setShareLinkRef}
            className={classNames("ShareLink", {
              "ShareLink--shown": shareURL
            })}
          />
        }
      >
        <Dropdown
          onToggle={onToggleDiff}
          icon={<Icon width={"32"} height="20" name="code" />}
          title="View changes"
        >
          <div className="ViewChanges">
            <CodeDiff stylesheets={stylesheets} />
            <div className="ViewChanges-actions">
              <a
                href={this.state.downloadURL}
                download={this.getFilename()}
                className="ViewChanges-action"
              >
                <div className="ViewChanges-action-text">Download</div>
              </a>
              <div className="ViewChanges-separator" />
              <div onClick={onExport} className="ViewChanges-action">
                <div className="ViewChanges-action-text">Create Gist</div>
              </div>
            </div>
          </div>
        </Dropdown>
        <Dropdown
          onClick={onShareChanges}
          icon={<Icon width={"24"} height="21" name="share" />}
          title="Share changes"
        />
      </HeaderBar>
    );
  }
}

class CreateStyleURLContainer extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      width: INITIAL_WIDTH,
      shareURL: "",
      hidden: false,
      stylesheets: []
    };

    this._connection = messenger.initConnection(
      PORT_TYPES.inline_header,
      this.handleMessage
    );
  }

  handleMessage = async (request, from, sender, sendResponse) => {
    const kinds = MESSAGE_TYPES;
    const { kind = null } = request;
    if (kind === kinds.style_diff_changed) {
      this.syncStylesheets();
    }
  };

  componentWillUnmount() {
    if (this._connection) {
      this._connection.disconnect();
    }
  }

  syncStylesheets = () => {
    this._sendMessage({
      kind: MESSAGE_TYPES.get_current_styles_diff
    }).then(({ stylesheets }) => {
      this.setState({
        stylesheets: stylesheets.map(({ content, url }) => [
          _.last(url.split("/")),
          content
        ])
      });
    });
  };

  setShareLinkRef = shareLinkRef => (this.shareLinkRef = shareLinkRef);

  handleToggleDiff = isOpen => {
    if (isOpen) {
      this.syncStylesheets();
    }
  };

  _sendMessage = message => {
    return this._connection.sendMessage(
      `background:${PORT_TYPES.inline_header}`,
      message
    );
  };

  handleExport = async () => {
    const { stylesheets } = await this._sendMessage({
      kind: MESSAGE_TYPES.get_current_styles_diff
    });

    if (!stylesheets || !stylesheets.length) {
      alert("Please make some CSS changes and try again");
      return;
    }

    this._sendMessage({
      kind: MESSAGE_TYPES.upload_stylesheets,
      value: {
        stylesheets,
        visibility: "private"
      }
    }).then(response => {
      if (response && response.data && response.data.url) {
        window.open(response.data.url, "_blank");
      }
    });
  };

  handleShareChanges = () => {
    return this._sendMessage({
      kind: MESSAGE_TYPES.get_current_styles_diff
    }).then(({ stylesheets }) => {
      if (!stylesheets || !stylesheets.length) {
        alert("Please make some CSS changes and try again");
        return;
      }

      this._sendMessage({
        kind: MESSAGE_TYPES.upload_stylesheets,
        value: {
          stylesheets,
          visibility: "public"
        }
      }).then(response => {
        if (
          response &&
          response.success &&
          response.data.visibility === "publicly_visible"
        ) {
          const shareURL = response.data.share_url;

          this.setState({ shareURL }, () => {
            navigator.clipboard.writeText(shareURL).then(
              () => {
                this._sendMessage({
                  kind: MESSAGE_TYPES.send_success_notification,
                  value: {
                    didCopy: true
                  }
                });
              },
              () =>
                this._sendMessage({
                  kind: MESSAGE_TYPES.send_success_notification,
                  value: {
                    didCopy: false
                  }
                })
            );
          });

          window.open(response.data.url, "_blank");
        }
      });
    });
  };

  handleHide = () => {
    this.setState({
      hidden: true
    });

    const shadowRoot = document.querySelector(
      `#${injectScriptNames.inject_create_styleurl}`
    );
    shadowRoot.style.display = "none";
  };

  render() {
    return (
      <CreateStyleURL
        hidden={this.state.hidden}
        onExport={this.handleExport}
        onShareChanges={this.handleShareChanges}
        onHide={this.handleHide}
        stylesheets={this.state.stylesheets}
        onToggleDiff={this.handleToggleDiff}
        setShareLinkRef={this.setShareLinkRef}
        shareURL={this.state.shareURL}
      />
    );
  }
}

export default CreateStyleURLContainer;
