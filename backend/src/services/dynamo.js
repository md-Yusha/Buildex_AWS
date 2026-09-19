import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-south-1"
});

export const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export const TABLES = {
  USERS: process.env.USERS_TABLE || "BuildexUsers",
  PROJECTS: process.env.PROJECTS_TABLE || "BuildexProjects",
  SESSIONS: process.env.SESSIONS_TABLE || "BuildexSessions",
  PROGRESS: process.env.PROGRESS_TABLE || "BuildexProgress",
  CHATS: process.env.CHATS_TABLE || "BuildexChats",
  PAYMENTS: process.env.PAYMENTS_TABLE || "BuildexPayments"
};
