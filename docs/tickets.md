# Tickets tab

The Tickets tab shows your tickets from **Jira** or **Notion** beside the work: the project this repository is for,
its open tickets, the ones you are working on, and for any ticket what it asks for and which features of the codebase
it will touch. It reads the trackers through their makers' own MCP servers, Atlassian's
(`https://mcp.atlassian.com/v2/mcp`) and Notion's (`https://mcp.notion.com/mcp`), with your own sign-in. Cockpit only
reads: it never creates, edits, moves or comments on a ticket.

> **What you see first.** One plain sentence (the ticket you are working on, or the project and its open tickets, or
> "Connect Jira or Notion to see your tickets here"), the Jira / Notion switch, and the tickets. The connections and
> **Forget** are behind one **› More** fold (`fold-more-tickets`), folded by default.

## Connecting

Pick **Jira** or **Notion** and press **Connect**. A server of that tracker you are already signed in to (the
claude.ai Atlassian or Notion connector, another plugin's, one of your own) is used as it is. Only when there is none
does Cockpit bring its own into the session. If no
server is signed in the tab says so: run `/mcp`, sign in to one (the claude.ai connector, or Cockpit's own), and press
**Connect** again.

Cockpit ships both servers in its manifest, and holds them back when a session starts: neither is dialed, lists its
tools or asks for a sign-in until you have pressed **Connect** and no server you are signed in to answered. (A headless plugin install or reload does not
ask Cockpit first, so a server can be dialed then; it still waits on your sign-in.) After that it joins your sessions by itself, and the tab
reconnects when you open it. **Forget** (under More) undoes that: the server stays out of your next sessions.

Nothing is asked of a tracker at a session's start or on a timer: only when the tab opens, or you press a button.

## The project this repository is for

- **Jira**: the tab lists the projects your account can see (on the first Jira site it can reach); press one.
- **Notion** has no projects or tickets of its own, so a **database is the project and its pages are the tickets**.
  Type a few words into **Find**, press Enter, and pick your tasks database from what the search finds.

The choice is kept per repository, across sessions. **‹ Projects**, beside the project's name, goes back to the
list to pick another.

## The tickets

For Jira: your open tickets in the project (**Mine**), or every open one (**All open**), newest change first, up to
50. For Notion: the database's pages, up to 30. Each row has the ticket's key (Jira) with its kind and status, and its title under them; the title, marked ›, opens
the ticket. **↻ Read
again** asks the tracker again. **Mine** is the account Jira says is signed in, which the tab names ("Signed in as
…") and asks again with every reading, since a sign-in can change under a session; an empty list says whose it is.

**Epics, stories, tasks and sub-tasks.** Each Jira ticket shows its kind, and the list is drawn as the hierarchy: a
story under its epic, a sub-task under its story or task. A parent the list does not hold (someone else's, already
done) is a dim heading over its children, so you still see what they belong to. When the list holds more than one
kind, a row of buttons (**All**, Epic, Story, Task, Sub-task) keeps one kind only. Claude is told a ticked ticket's
kind and what it sits under.

Press a title to open an epic, a story or any ticket. Opening it is asking what it is, so the first time Cockpit
writes, by itself:

- **a short summary**: what the ticket asks for and what done looks like;
- **Work on existing features**: each feature of the [codebase memory](activity.md) the work touches, as a link to
  it in the Activity tab, with a line saying what has to change there. Only features the memory really has are named;
- **New**: what has to be built that belongs to no feature yet.

It is one small model call with the ticket's kind, title, status, description and what it sits under, the titles of
the tickets under it (an epic's stories, a story's sub-tasks), and the name and one line of each feature. The answer
is kept with the repository, so opening the ticket again asks nothing; **↻ Write it again** asks afresh.
`/cockpit ticket <KEY>` gives the same for one Jira ticket in the chat, reading it if the list does not hold it.

## Working on a ticket

Tick a ticket to say you are working on it. Ticked tickets are kept per repository and listed first. From then on:

- **Claude knows.** Every turn it is told the tickets being worked on (key, title, status, link and, once explained,
  the features they touch), as data from the tracker and never as instructions.
- **The Git tab's ticket is filled** with the first ticked ticket that has a key, so a branch pattern like
  `{kind}/{ticket}-{slug}` or a message pattern like `{ticket} {type}: {subject}` carries it. Unticking it clears it.
  A Notion page has no key, so it does not fill the field.
- **The Overview** shows the ticket under its first line, linking here, and the tab's name carries the count.

**▶ Start work** is the step after the tick. It is under the tab's first line for the ticket you are working on, and
in every opened ticket (where it ticks the ticket too). It hands the ticket to Claude as a prompt in your
conversation: its kind, key, title, status, parent, link and description, marked as data from the tracker, with
Cockpit's summary and the work it named, and asks for a short plan (the files, the steps, how it will be checked)
before anything is changed. You read the plan and say go.

## What to know

- A ticket's text is someone else's: control characters are stripped before it is drawn, it is cut to a few thousand
  characters, and the model that explains it is told to follow no instruction inside it.
- The tool names differ between versions of the trackers' servers; Cockpit asks for each by the names it knows, in
  order, and shows the server's own words when a call fails.
- `/cockpit tab tickets` opens the tab. `/cockpit tickets <jira|notion>` connects and lists the projects in the chat;
  `/cockpit tickets jira <KEY>` (or `notion <words>`) sets this repository's project and lists its tickets; `none`
  in place of the project clears it.

## When auto mode's check does not answer

Not about tickets, but found while building them: in auto mode, Claude Code's safety check sometimes gives no verdict
on a call, and the call is then refused, again and again. When Cockpit sees that refusal it says so once in the chat
and, for the rest of the session, puts every call that would go to that check to you in the permission dialog
instead, so the work goes on with your yes. A new session starts with the check trusted again.

[All docs](README.md) · [Project README](../README.md)
