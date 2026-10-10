import type {WorkspaceCommand} from './command-shortcuts'
export const TEXT_EDIT_COMMANDS:WorkspaceCommand[]=[
 {id:'text:trackingDown',title:'Decrease Text Tracking',category:'Text',shortcut:'Alt+arrowleft'},
 {id:'text:trackingUp',title:'Increase Text Tracking',category:'Text',shortcut:'Alt+arrowright'},
 {id:'text:leadingDown',title:'Decrease Text Leading',category:'Text',shortcut:'Alt+arrowup'},
 {id:'text:leadingUp',title:'Increase Text Leading',category:'Text',shortcut:'Alt+arrowdown'},
 {id:'text:trackingDownLarge',title:'Decrease Text Tracking by 10',category:'Text',shortcut:'Alt+Shift+arrowleft'},
 {id:'text:trackingUpLarge',title:'Increase Text Tracking by 10',category:'Text',shortcut:'Alt+Shift+arrowright'},
 {id:'text:leadingDownLarge',title:'Decrease Text Leading by 10',category:'Text',shortcut:'Alt+Shift+arrowup'},
 {id:'text:leadingUpLarge',title:'Increase Text Leading by 10',category:'Text',shortcut:'Alt+Shift+arrowdown'},
 {id:'text:commit',title:'Apply Text Edit',category:'Text',shortcut:'Primary+enter'},
 {id:'cancel-draft',title:'Cancel Text Edit',category:'Text',shortcut:'escape'}
]
