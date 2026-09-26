import { PageHeader } from "@/components/shell/page-header";
import { ChatPanel } from "@/components/chat/chat-panel";

export const metadata = { title: "Research chat" };

export default function ChatPage() {
  return (
    <>
      <PageHeader
        title="Research chat"
        description="Answers come from the same stored calculations and source documents the dashboard shows. It abstains rather than guessing."
      />
      <ChatPanel />
    </>
  );
}
