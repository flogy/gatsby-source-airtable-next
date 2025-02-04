"use strict";
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.onCreateDevServer =
  exports.createSchemaCustomization =
  exports.onCreateNode =
  exports.sourceNodes =
  exports.pluginOptionsSchema =
    void 0;
const airtable_1 = __importDefault(require("airtable"));
const polyfill_remote_file_1 = require("gatsby-plugin-utils/polyfill-remote-file");
const lodash_1 = __importDefault(require("lodash"));
const constants_1 = require("./constants");
const utils_1 = require("./utils");
const gatsby_source_filesystem_1 = require("gatsby-source-filesystem");
const pluginOptionsSchema = ({ Joi }) => {
  return Joi.object({
    apiKey: Joi.string().required(),
    tables: Joi.array().required(),
    refreshInterval: Joi.number().min(0).default(0),
  });
};
exports.pluginOptionsSchema = pluginOptionsSchema;
// https://www.gatsbyjs.org/docs/node-apis/#sourceNodes
const sourceNodes = async (args, options) => {
  const {
    actions,
    cache,
    createNodeId,
    getNode,
    createContentDigest,
    reporter,
  } = args;
  const { createNode, touchNode } = actions;
  try {
    const rows = [];
    const { refreshInterval = 0 } = options;
    const airtableNodeIds = await cache.get(
      "gatsby-source-airtable-next-nodes-ids"
    );
    const airtableRowsTimestamp = await cache.get(
      "gatsby-source-airtable-next-rows-timestamp"
    );
    const existingNodesAge = Date.now() - airtableRowsTimestamp;
    if (airtableNodeIds && existingNodesAge <= refreshInterval) {
      airtableNodeIds.forEach((id) => {
        const node = getNode(id);
        if (node) {
          touchNode(node);
        }
      });
      reporter.info(`Airtable: using cached nodes`);
    } else {
      const nodesIds = [];
      const promises = options.tables.map(async (table) => {
        return new Promise((resolve, reject) => {
          const now = new Date();
          const base = new airtable_1.default({ apiKey: options.apiKey }).base(
            table.baseId
          );
          const viewOptions = table.tableView
            ? { view: table.tableView }
            : undefined;
          base(table.tableName)
            .select(viewOptions)
            .eachPage(
              function page(records, fetchNextPage) {
                // This function (`page`) will get called for each page of records.
                records.forEach(function (record) {
                  const fields = lodash_1.default.mapKeys(
                    record.fields,
                    (_v, k) => lodash_1.default.camelCase(k)
                  );
                  rows.push({
                    airtableId: record.getId(),
                    ...fields,
                  });
                });
                // To fetch the next page of records, call `fetchNextPage`.
                // If there are more records, `page` will get called again.
                // If there are no more records, `done` will get called.
                fetchNextPage();
              },
              async function done(err) {
                if (err) {
                  reject(err);
                  return;
                }
                const nodeType = (0, utils_1.pascalCase)(
                  `${constants_1.NODE_TYPE} ${table.tableName}`
                );
                // Loop through data and create Gatsby nodes
                rows.forEach((row) => {
                  const id = createNodeId(`${nodeType}-${row.airtableId}`);
                  nodesIds.push(id);
                  createNode({
                    ...row,
                    id,
                    parent: null,
                    children: [],
                    internal: {
                      type: nodeType,
                      content: JSON.stringify(row),
                      contentDigest: createContentDigest(row),
                    },
                  });
                });
                const seconds = (Date.now() - now.getTime()) / 1000;
                reporter.info(
                  `Airtable: Created ${rows.length} ${(0, utils_1.pascalCase)(
                    `${constants_1.NODE_TYPE} ${table.tableName}`
                  )} nodes - ${seconds}s`
                );
                // Done! 🎉
                resolve();
              }
            );
        });
      });
      await Promise.all(promises);
      await cache.set("gatsby-source-airtable-next-nodes-ids", nodesIds);
      await cache.set(
        "gatsby-source-airtable-next-rows-timestamp",
        `${Date.now()}`
      );
    }
  } catch (error) {
    console.error(
      "Uh-oh, something went wrong with Airtable node creation.",
      error
    );
  }
};
exports.sourceNodes = sourceNodes;
//www.gatsbyjs.com/docs/reference/config-files/gatsby-node/#onCreateNode
const onCreateNode = async (args, options) => {
  const { node, actions, createNodeId, cache, getNode, getCache, reporter } =
    args;
  const { createNode, createNodeField, touchNode } = actions;
  const nodeTypes = options.tables.map((table) =>
    (0, utils_1.pascalCase)(`${constants_1.NODE_TYPE} ${table.tableName}`)
  );
  if (nodeTypes.includes(node.internal.type)) {
    // Find any attachement fields
    for (const [, value] of Object.entries(node)) {
      // Attachment fields are always arrays
      if (Array.isArray(value)) {
        value.forEach(async (obj) => {
          if ((0, utils_1.isAttachmentField)(obj)) {
            const { refreshInterval = 0 } = options;
            const airtableAttachmentNodeId = createNodeId(
              `airtable-attachment-${obj.id}`
            );
            const existingNode = getNode(airtableAttachmentNodeId);
            const existingAttachmentNode = getNode(airtableAttachmentNodeId);
            const timestamp = await cache.get(airtableAttachmentNodeId);
            const existingNodeAge = Date.now() - timestamp;
            if (existingNode && existingNodeAge <= refreshInterval) {
              // Node already exists, make sure it stays around
              touchNode(existingNode);
              if (existingAttachmentNode) {
                touchNode(existingAttachmentNode);
              }
            } else {
              const airtableAttachmentNode = {
                id: airtableAttachmentNodeId,
                airtableId: obj.id,
                url: obj.url,
                width: obj.width,
                height: obj.height,
                filename: obj.filename,
                parent: node.id,
                placeholderUrl: obj.thumbnails.small.url,
                mimeType: obj.type,
                pluginName: "gatsby-source-airtable-next",
                internal: {
                  type: "AirtableAttachment",
                  contentDigest: node.internal.contentDigest,
                },
              };
              createNode(airtableAttachmentNode);
              await cache.set(airtableAttachmentNodeId, `${Date.now()}`);
            }
            // always create localFile key on obj
            // createRemoteFileNode takes care of cache
            let fileNode;
            try {
              fileNode = await (0,
              gatsby_source_filesystem_1.createRemoteFileNode)({
                url: obj.url,
                parentNodeId: airtableAttachmentNodeId,
                getCache,
                createNode,
                createNodeId,
                ext: (0, utils_1.getExtension)(obj.type),
              });
            } catch (e) {
              reporter.panic(
                `gatsby-source-airtable-next: createRemoteFileNode failed for ${obj.url}`
              );
            }
            if (fileNode && existingNode) {
              createNodeField({
                node: existingNode,
                name: "localFile",
                value: fileNode.id,
              });
            }
          }
        });
      }
    }
  }
};
exports.onCreateNode = onCreateNode;
// https://www.gatsbyjs.org/docs/node-apis/#createSchemaCustomization
const createSchemaCustomization = (args, options) => {
  const { actions, schema, store } = args;
  const strings = [];
  options.tables.forEach((table) => {
    const fromType = (0, utils_1.pascalCase)(
      `${constants_1.NODE_TYPE} ${table.tableName}`
    );
    // link records
    if (Array.isArray(table.recordLinks)) {
      table.recordLinks.forEach((recordLink) => {
        const toType = (0, utils_1.pascalCase)(
          `${constants_1.NODE_TYPE} ${recordLink.toTable}`
        );
        const key = lodash_1.default.camelCase(recordLink.fromField);
        strings.push(`type ${fromType} implements Node {
            ${key}: [${toType}] @link(by: "airtableId")
          }
          type AirtableAttachment implements Node {
            localFile: File @link(from: "fields.localFile")
          }`);
      });
    }
    // link attachments
    if (Array.isArray(table.downloadLocal)) {
      table.downloadLocal.forEach((field) => {
        const key = lodash_1.default.camelCase(field);
        strings.push(`type ${fromType} implements Node {
            ${key}: [AirtableAttachment] @link(by: "airtableId", from: "${key}.id")
          }`);
      });
    }
  });
  const typeDefs = strings.join(`
`);
  actions.createTypes(typeDefs);
  actions.createTypes([
    (0, polyfill_remote_file_1.addRemoteFilePolyfillInterface)(
      schema.buildObjectType({
        name: "AirtableAttachment",
        fields: {
          airtableId: "String!",
        },
        interfaces: ["Node", "RemoteFile"],
      }),
      {
        schema,
        actions,
        store,
      }
    ),
  ]);
};
exports.createSchemaCustomization = createSchemaCustomization;
const onCreateDevServer = (args) => {
  const { app } = args;
  (0, polyfill_remote_file_1.polyfillImageServiceDevRoutes)(app);
};
exports.onCreateDevServer = onCreateDevServer;
