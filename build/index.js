#!/usr/bin/env node
/**
 * ERPNext MCP Server
 * This server provides integration with the ERPNext/Frappe API, allowing:
 * - Authentication with ERPNext
 * - Fetching documents from ERPNext
 * - Querying lists of documents
 * - Creating and updating documents
 * - Running reports
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ErrorCode, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema, McpError, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
// ERPNext API client configuration
class ERPNextClient {
    baseUrl;
    axiosInstance;
    authenticated = false;
    constructor() {
        // Get ERPNext configuration from environment variables
        this.baseUrl = process.env.ERPNEXT_URL || '';
        // Validate configuration
        if (!this.baseUrl) {
            throw new Error("ERPNEXT_URL environment variable is required");
        }
        // Remove trailing slash if present
        this.baseUrl = this.baseUrl.replace(/\/$/, '');
        // Initialize axios instance
        this.axiosInstance = axios.create({
            baseURL: this.baseUrl,
            withCredentials: true,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
        // Configure authentication if credentials provided
        const apiKey = process.env.ERPNEXT_API_KEY;
        const apiSecret = process.env.ERPNEXT_API_SECRET;
        if (apiKey && apiSecret) {
            this.axiosInstance.defaults.headers.common['Authorization'] =
                `token ${apiKey}:${apiSecret}`;
            this.authenticated = true;
        }
    }
    isAuthenticated() {
        return this.authenticated;
    }
    // Get a document by doctype and name
    async getDocument(doctype, name) {
        try {
            const response = await this.axiosInstance.get(`/api/resource/${doctype}/${name}`);
            return response.data.data;
        }
        catch (error) {
            throw new Error(`Failed to get ${doctype} ${name}: ${error?.message || 'Unknown error'}`);
        }
    }
    // Get list of documents for a doctype
    async getDocList(doctype, filters, fields, limit) {
        try {
            let params = {};
            if (fields && fields.length) {
                params['fields'] = JSON.stringify(fields);
            }
            if (filters) {
                params['filters'] = JSON.stringify(filters);
            }
            if (limit) {
                params['limit_page_length'] = limit;
            }
            const response = await this.axiosInstance.get(`/api/resource/${doctype}`, { params });
            return response.data.data;
        }
        catch (error) {
            throw new Error(`Failed to get ${doctype} list: ${error?.message || 'Unknown error'}`);
        }
    }
    // Create a new document
    async createDocument(doctype, doc) {
        try {
            const response = await this.axiosInstance.post(`/api/resource/${doctype}`, {
                data: doc
            });
            return response.data.data;
        }
        catch (error) {
            throw new Error(`Failed to create ${doctype}: ${error?.message || 'Unknown error'}`);
        }
    }
    // Update an existing document
    async updateDocument(doctype, name, doc) {
        try {
            const response = await this.axiosInstance.put(`/api/resource/${doctype}/${name}`, {
                data: doc
            });
            return response.data.data;
        }
        catch (error) {
            throw new Error(`Failed to update ${doctype} ${name}: ${error?.message || 'Unknown error'}`);
        }
    }
    // Run a report
    async runReport(reportName, filters) {
        try {
            const response = await this.axiosInstance.get(`/api/method/frappe.desk.query_report.run`, {
                params: {
                    report_name: reportName,
                    filters: filters ? JSON.stringify(filters) : undefined
                }
            });
            return response.data.message;
        }
        catch (error) {
            throw new Error(`Failed to run report ${reportName}: ${error?.message || 'Unknown error'}`);
        }
    }
    // Get all available DocTypes
    async getAllDocTypes() {
        try {
            // Use the standard REST API to fetch DocTypes
            const response = await this.axiosInstance.get('/api/resource/DocType', {
                params: {
                    fields: JSON.stringify(["name"]),
                    limit_page_length: 500 // Get more doctypes at once
                }
            });
            if (response.data && response.data.data) {
                return response.data.data.map((item) => item.name);
            }
            return [];
        }
        catch (error) {
            console.error("Failed to get DocTypes:", error?.message || 'Unknown error');
            // Try an alternative approach if the first one fails
            try {
                // Try using the method API to get doctypes
                const altResponse = await this.axiosInstance.get('/api/method/frappe.desk.search.search_link', {
                    params: {
                        doctype: 'DocType',
                        txt: '',
                        limit: 500
                    }
                });
                if (altResponse.data && altResponse.data.results) {
                    return altResponse.data.results.map((item) => item.value);
                }
                return [];
            }
            catch (altError) {
                console.error("Alternative DocType fetch failed:", altError?.message || 'Unknown error');
                // Fallback: Return a list of common DocTypes
                return [
                    "Customer", "Supplier", "Item", "Sales Order", "Purchase Order",
                    "Sales Invoice", "Purchase Invoice", "Employee", "Lead", "Opportunity",
                    "Quotation", "Payment Entry", "Journal Entry", "Stock Entry"
                ];
            }
        }
    }
}
// Cache for doctype metadata
const doctypeCache = new Map();
// Initialize ERPNext client
const erpnext = new ERPNextClient();
// Create an MCP server with capabilities for resources and tools
const server = new Server({
    name: "erpnext-server",
    version: "0.1.0"
}, {
    capabilities: {
        resources: {},
        tools: {}
    }
});
/**
 * Handler for listing available ERPNext resources.
 * Exposes DocTypes list as a resource and common doctypes as individual resources.
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    // List of common DocTypes to expose as individual resources
    const commonDoctypes = [
        "Customer",
        "Supplier",
        "Item",
        "Sales Order",
        "Purchase Order",
        "Sales Invoice",
        "Purchase Invoice",
        "Employee"
    ];
    const resources = [
        // Add a resource to get all doctypes
        {
            uri: "erpnext://DocTypes",
            name: "All DocTypes",
            mimeType: "application/json",
            description: "List of all available DocTypes in the ERPNext instance"
        }
    ];
    return {
        resources
    };
});
/**
 * Handler for resource templates.
 * Allows querying ERPNext documents by doctype and name.
 */
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    const resourceTemplates = [
        {
            uriTemplate: "erpnext://{doctype}/{name}",
            name: "ERPNext Document",
            mimeType: "application/json",
            description: "Fetch an ERPNext document by doctype and name"
        }
    ];
    return { resourceTemplates };
});
/**
 * Handler for reading ERPNext resources.
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (!erpnext.isAuthenticated()) {
        throw new McpError(ErrorCode.InvalidRequest, "Not authenticated with ERPNext. Please configure API key authentication.");
    }
    const uri = request.params.uri;
    let result;
    // Handle special resource: erpnext://DocTypes (list of all doctypes)
    if (uri === "erpnext://DocTypes") {
        try {
            const doctypes = await erpnext.getAllDocTypes();
            result = { doctypes };
        }
        catch (error) {
            throw new McpError(ErrorCode.InternalError, `Failed to fetch DocTypes: ${error?.message || 'Unknown error'}`);
        }
    }
    else {
        // Handle document access: erpnext://{doctype}/{name}
        const documentMatch = uri.match(/^erpnext:\/\/([^\/]+)\/(.+)$/);
        if (documentMatch) {
            const doctype = decodeURIComponent(documentMatch[1]);
            const name = decodeURIComponent(documentMatch[2]);
            try {
                result = await erpnext.getDocument(doctype, name);
            }
            catch (error) {
                throw new McpError(ErrorCode.InvalidRequest, `Failed to fetch ${doctype} ${name}: ${error?.message || 'Unknown error'}`);
            }
        }
    }
    if (!result) {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid ERPNext resource URI: ${uri}`);
    }
    return {
        contents: [{
                uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify(result, null, 2)
            }]
    };
});
/**
 * Handler that lists available tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_doctypes",
                description: "Get a list of all available DocTypes",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "get_doctype_fields",
                description: "Get fields list for a specific DocType",
                inputSchema: {
                    type: "object",
                    properties: {
                        doctype: {
                            type: "string",
                            description: "ERPNext DocType (e.g., Customer, Item)"
                        }
                    },
                    required: ["doctype"]
                }
            },
            {
                name: "get_documents",
                description: "Get a list of documents for a specific doctype",
                inputSchema: {
                    type: "object",
                    properties: {
                        doctype: {
                            type: "string",
                            description: "ERPNext DocType (e.g., Customer, Item)"
                        },
                        fields: {
                            type: "array",
                            items: {
                                type: "string"
                            },
                            description: "Fields to include (optional)"
                        },
                        filters: {
                            type: "object",
                            additionalProperties: true,
                            description: "Filters in the format {field: value} (optional)"
                        },
                        limit: {
                            type: "number",
                            description: "Maximum number of documents to return (optional)"
                        }
                    },
                    required: ["doctype"]
                }
            },
            {
                name: "create_document",
                description: "Create a new document in ERPNext",
                inputSchema: {
                    type: "object",
                    properties: {
                        doctype: {
                            type: "string",
                            description: "ERPNext DocType (e.g., Customer, Item)"
                        },
                        data: {
                            type: "object",
                            additionalProperties: true,
                            description: "Document data"
                        }
                    },
                    required: ["doctype", "data"]
                }
            },
            {
                name: "update_document",
                description: "Update an existing document in ERPNext",
                inputSchema: {
                    type: "object",
                    properties: {
                        doctype: {
                            type: "string",
                            description: "ERPNext DocType (e.g., Customer, Item)"
                        },
                        name: {
                            type: "string",
                            description: "Document name/ID"
                        },
                        data: {
                            type: "object",
                            additionalProperties: true,
                            description: "Document data to update"
                        }
                    },
                    required: ["doctype", "name", "data"]
                }
            },
            {
                name: "run_report",
                description: "Run an ERPNext report",
                inputSchema: {
                    type: "object",
                    properties: {
                        report_name: {
                            type: "string",
                            description: "Name of the report"
                        },
                        filters: {
                            type: "object",
                            additionalProperties: true,
                            description: "Report filters (optional)"
                        }
                    },
                    required: ["report_name"]
                }
            }
        ]
    };
});
/**
 * Handler for tool calls.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
        case "get_documents": {
            if (!erpnext.isAuthenticated()) {
                return {
                    content: [{
                            type: "text",
                            text: "Not authenticated with ERPNext. Please configure API key authentication."
                        }],
                    isError: true
                };
            }
            const doctype = String(request.params.arguments?.doctype);
            const fields = request.params.arguments?.fields;
            const filters = request.params.arguments?.filters;
            const limit = request.params.arguments?.limit;
            if (!doctype) {
                throw new McpError(ErrorCode.InvalidParams, "Doctype is required");
            }
            try {
                const documents = await erpnext.getDocList(doctype, filters, fields, limit);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(documents, null, 2)
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: `Failed to get ${doctype} documents: ${error?.message || 'Unknown error'}`
                        }],
                    isError: true
                };
            }
        }
        case "create_document": {
            if (!erpnext.isAuthenticated()) {
                return {
                    content: [{
                            type: "text",
                            text: "Not authenticated with ERPNext. Please configure API key authentication."
                        }],
                    isError: true
                };
            }
            const doctype = String(request.params.arguments?.doctype);
            const data = request.params.arguments?.data;
            if (!doctype || !data) {
                throw new McpError(ErrorCode.InvalidParams, "Doctype and data are required");
            }
            try {
                const result = await erpnext.createDocument(doctype, data);
                return {
                    content: [{
                            type: "text",
                            text: `Created ${doctype}: ${result.name}\n\n${JSON.stringify(result, null, 2)}`
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: `Failed to create ${doctype}: ${error?.message || 'Unknown error'}`
                        }],
                    isError: true
                };
            }
        }
        case "update_document": {
            if (!erpnext.isAuthenticated()) {
                return {
                    content: [{
                            type: "text",
                            text: "Not authenticated with ERPNext. Please configure API key authentication."
                        }],
                    isError: true
                };
            }
            const doctype = String(request.params.arguments?.doctype);
            const name = String(request.params.arguments?.name);
            const data = request.params.arguments?.data;
            if (!doctype || !name || !data) {
                throw new McpError(ErrorCode.InvalidParams, "Doctype, name, and data are required");
            }
            try {
                const result = await erpnext.updateDocument(doctype, name, data);
                return {
                    content: [{
                            type: "text",
                            text: `Updated ${doctype} ${name}\n\n${JSON.stringify(result, null, 2)}`
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: `Failed to update ${doctype} ${name}: ${error?.message || 'Unknown error'}`
                        }],
                    isError: true
                };
            }
        }
        case "run_report": {
            if (!erpnext.isAuthenticated()) {
                return {
                    content: [{
                            type: "text",
                            text: "Not authenticated with ERPNext. Please configure API key authentication."
                        }],
                    isError: true
                };
            }
            const reportName = String(request.params.arguments?.report_name);
            const filters = request.params.arguments?.filters;
            if (!reportName) {
                throw new McpError(ErrorCode.InvalidParams, "Report name is required");
            }
            try {
                const result = await erpnext.runReport(reportName, filters);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(result, null, 2)
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: `Failed to run report ${reportName}: ${error?.message || 'Unknown error'}`
                        }],
                    isError: true
                };
            }
        }
        case "get_doctype_fields": {
            if (!erpnext.isAuthenticated()) {
                return {
                    content: [{
                            type: "text",
                            text: "Not authenticated with ERPNext. Please configure API key authentication."
                        }],
                    isError: true
                };
            }
            const doctype = String(request.params.arguments?.doctype);
            if (!doctype) {
                throw new McpError(ErrorCode.InvalidParams, "Doctype is required");
            }
            try {
                // Get a sample document to understand the fields
                const documents = await erpnext.getDocList(doctype, {}, ["*"], 1);
                if (!documents || documents.length === 0) {
                    return {
                        content: [{
                                type: "text",
                                text: `No documents found for ${doctype}. Cannot determine fields.`
                            }],
                        isError: true
                    };
                }
                // Extract field names from the first document
                const sampleDoc = documents[0];
                const fields = Object.keys(sampleDoc).map(field => ({
                    fieldname: field,
                    value: typeof sampleDoc[field],
                    sample: sampleDoc[field]?.toString()?.substring(0, 50) || null
                }));
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(fields, null, 2)
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: `Failed to get fields for ${doctype}: ${error?.message || 'Unknown error'}`
                        }],
                    isError: true
                };
            }
        }
        case "get_doctypes": {
            if (!erpnext.isAuthenticated()) {
                return {
                    content: [{
                            type: "text",
                            text: "Not authenticated with ERPNext. Please configure API key authentication."
                        }],
                    isError: true
                };
            }
            try {
                const doctypes = await erpnext.getAllDocTypes();
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify(doctypes, null, 2)
                        }]
                };
            }
            catch (error) {
                return {
                    content: [{
                            type: "text",
                            text: `Failed to get DocTypes: ${error?.message || 'Unknown error'}`
                        }],
                    isError: true
                };
            }
        }
        default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
});
/**
 * Start the server using stdio transport.
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('ERPNext MCP server running on stdio');
}
main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
