"""Realizzazioni della porta `AgentProfile`: una per agente."""

from .changelog_tech import ChangelogTechProfile
from .docs_inline import DocsInlineProfile
from .owasp_scan import OwaspScanProfile

__all__ = ["DocsInlineProfile", "OwaspScanProfile", "ChangelogTechProfile"]

PROFILES = {
    "docs": DocsInlineProfile,
    "owasp": OwaspScanProfile,
    "changelog": ChangelogTechProfile,
}
